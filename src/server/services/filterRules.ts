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
  interface GroupState {
    risky: boolean;
  }
  const stack: GroupState[] = [{ risky: false }];
  let inClass = false;

  const quantifierAt = (index: number): { length: number; repeats: boolean } | null => {
    const ch = source[index];
    if (ch === '*' || ch === '+') return { length: 1, repeats: true };
    if (ch === '?') return { length: 1, repeats: false };
    if (ch === '{') {
      const m = /^\{(\d*)(,?)(\d*)\}/.exec(source.slice(index));
      if (!m) return null;
      const max = m[2] ? (m[3] ? Number(m[3]) : Infinity) : Number(m[1]);
      return { length: m[0].length, repeats: max > 1 };
    }
    return null;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const top = stack[stack.length - 1] as GroupState;

    if (ch === '\\') {
      const next = source[i + 1] ?? '';
      if (!inClass && (/[1-9]/.test(next) || next === 'k')) {
        return 'backreferences are not allowed';
      }
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      stack.push({ risky: false });
      // Skip group modifiers so their `?` is not mistaken for a quantifier.
      const modifier = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(source.slice(i + 1));
      if (modifier) i += modifier[0].length;
      continue;
    }
    if (ch === '|') {
      top.risky = true;
      continue;
    }
    if (ch === ')') {
      const closed = stack.length > 1 ? (stack.pop() as GroupState) : top;
      const parent = stack[stack.length - 1] as GroupState;
      const quantifier = quantifierAt(i + 1);
      if (quantifier) {
        if (quantifier.repeats && closed.risky) {
          return 'nested quantifiers or quantified alternations are not allowed';
        }
        parent.risky = true;
        i += quantifier.length;
        if (source[i + 1] === '?') i += 1; // lazy modifier
      } else if (closed.risky) {
        parent.risky = true;
      }
      continue;
    }
    const quantifier = quantifierAt(i);
    if (quantifier) {
      top.risky = true;
      i += quantifier.length - 1;
      if (source[i + 1] === '?') i += 1; // lazy modifier
    }
  }
  return null;
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
