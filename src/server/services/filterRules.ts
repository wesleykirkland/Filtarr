/**
 * Parsing and validation for filter rule payloads, shared by the filter routes
 * (create/update validation) and the filter engine (evaluation).
 */

export const MAX_REGEX_PAYLOAD_LENGTH = 256;

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

const SIZE_PATTERN = /^([<>=])?\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|K|M|G|T)?$/i;

export interface ParsedSizeRule {
  operator: '<' | '>' | '=';
  value: number;
  unit: keyof typeof SIZE_UNITS;
  bytes: number;
}

/**
 * Parse a size rule such as `>100MB`, `< 1.5 g` or `=500B`. Bare K/M/G/T are
 * normalized to KB/MB/GB/TB. A missing unit (legacy rows) is only accepted
 * when `requireUnit` is false and means bytes.
 */
export function parseSizePayload(payload: string, requireUnit = false): ParsedSizeRule | null {
  const match = SIZE_PATTERN.exec(payload.trim());
  if (!match) return null;
  if (requireUnit && !match[3]) return null;

  const operator = (match[1] || '=') as ParsedSizeRule['operator'];
  const value = Number.parseFloat(match[2] ?? '0');
  let unit = (match[3] || 'B').toUpperCase();
  if (unit.length === 1 && unit !== 'B') unit = `${unit}B`;

  return { operator, value, unit, bytes: value * (SIZE_UNITS[unit] ?? 1) };
}

/** Canonical stored form of a size rule, e.g. `>100MB`. */
export function normalizeSizePayload(payload: string): string | null {
  const parsed = parseSizePayload(payload, true);
  return parsed ? `${parsed.operator}${parsed.value}${parsed.unit}` : null;
}

/**
 * Split an extension list into lowercase entries with leading dots stripped and
 * empty entries removed. Entries that are not `[a-z0-9]+` are dropped when
 * `strict` is false and make the result null when `strict` is true.
 */
export function parseExtensionPayload(payload: string, strict = false): string[] | null {
  const entries: string[] = [];
  for (const raw of payload.split(',')) {
    const entry = raw.trim().toLowerCase().replace(/^\.+/, '');
    if (!entry) continue;
    if (!/^[a-z0-9]+$/.test(entry)) {
      if (strict) return null;
      continue;
    }
    if (!entries.includes(entry)) entries.push(entry);
  }
  if (strict && entries.length === 0) return null;
  return entries;
}

/**
 * Conservative ReDoS guard. Rejects backreferences and any quantified group
 * whose body contains a quantifier or an alternation, e.g. `(a+)+`, `(a*)*`,
 * `(a|aa)+`, `(?:x\d+){2,}`. This also rejects some harmless patterns such as
 * `(mkv|mp4)+`; such rules can be written without the outer quantifier.
 */
export function findUnsafeRegexConstruct(source: string): string | null {
  const stack: RegexGroupState[] = [{ risky: false }];
  let inClass = false;

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const top = stack.at(-1) as RegexGroupState;
    // Index of the last character consumed by this step; the loop resumes after it.
    let last = i;

    if (ch === '\\') {
      if (!inClass && isBackreferenceEscape(source[i + 1] ?? '')) {
        return 'backreferences are not allowed';
      }
      last = i + 1;
    } else if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === '(') {
      stack.push({ risky: false });
      // Skip group modifiers so their `?` is not mistaken for a quantifier.
      last = i + groupModifierLength(source, i + 1);
    } else if (ch === '|') {
      top.risky = true;
    } else if (ch === ')') {
      const closed = stack.length > 1 ? (stack.pop() as RegexGroupState) : top;
      const parent = stack.at(-1) as RegexGroupState;
      const result = closeGroup(source, i, closed, parent);
      if (typeof result === 'string') return result;
      last = result;
    } else {
      const quantifier = quantifierAt(source, i);
      if (quantifier) {
        top.risky = true;
        last = skipLazyModifier(source, i + quantifier.length - 1);
      }
    }

    i = last + 1;
  }
  return null;
}

interface RegexGroupState {
  risky: boolean;
}

function isBackreferenceEscape(next: string): boolean {
  return /[1-9]/.test(next) || next === 'k';
}

function groupModifierLength(source: string, index: number): number {
  const modifier = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(source.slice(index, index + 64));
  return modifier ? modifier[0].length : 0;
}

/** If a lazy `?` follows position `index`, return its index; otherwise `index`. */
function skipLazyModifier(source: string, index: number): number {
  return source[index + 1] === '?' ? index + 1 : index;
}

/**
 * Handle a `)` at `index`. Returns an error message for an unsafe quantified
 * group, otherwise the index of the last character consumed.
 */
function closeGroup(
  source: string,
  index: number,
  closed: RegexGroupState,
  parent: RegexGroupState,
): string | number {
  const quantifier = quantifierAt(source, index + 1);
  if (!quantifier) {
    if (closed.risky) parent.risky = true;
    return index;
  }
  if (quantifier.repeats && closed.risky) {
    return 'nested quantifiers or quantified alternations are not allowed';
  }
  parent.risky = true;
  return skipLazyModifier(source, index + quantifier.length);
}

function quantifierAt(source: string, index: number): { length: number; repeats: boolean } | null {
  const ch = source[index];
  if (ch === '*' || ch === '+') return { length: 1, repeats: true };
  if (ch === '?') return { length: 1, repeats: false };
  if (ch === '{') return braceQuantifierAt(source, index);
  return null;
}

/** Parse `{n}`, `{n,}`, `{n,m}` or `{,m}` at `index` without regex backtracking. */
function braceQuantifierAt(
  source: string,
  index: number,
): { length: number; repeats: boolean } | null {
  const close = source.indexOf('}', index);
  if (close === -1) return null;
  const parts = source.slice(index + 1, close).split(',');
  const [min = '', max = ''] = parts;
  if (parts.length > 2 || !isDigits(min) || !isDigits(max)) return null;
  let upper = Number(min);
  if (parts.length === 2) upper = max ? Number(max) : Infinity;
  return { length: close - index + 1, repeats: upper > 1 };
}

function isDigits(value: string): boolean {
  for (const ch of value) {
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

/**
 * Validate a regex rule payload: bounded length, must compile, and must pass the
 * ReDoS guard. Returns an error message or null.
 */
export function getRegexPayloadViolation(payload: string): string | null {
  if (payload.length > MAX_REGEX_PAYLOAD_LENGTH) {
    return `Regex rule must be at most ${MAX_REGEX_PAYLOAD_LENGTH} characters`;
  }
  try {
    new RegExp(payload, 'i');
  } catch {
    return 'Regex rule is not a valid regular expression';
  }
  const unsafe = findUnsafeRegexConstruct(payload);
  return unsafe ? `Regex rule is potentially unsafe: ${unsafe}` : null;
}
