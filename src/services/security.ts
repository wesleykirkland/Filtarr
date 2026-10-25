import dns from 'node:dns';
import net, { type LookupFunction } from 'node:net';
import { Agent } from 'undici';

export class SecurityPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityPolicyError';
  }
}

interface ValidateUrlOptions {
  fieldName?: string;
}

interface UrlValidationPolicy {
  allowHttp: boolean;
  allowPrivateHosts: boolean;
}

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

type Ipv4Bytes = [number, number, number, number];

/** Parse a dotted-quad IPv4 address into bytes, or null if it is not one. */
function parseIpv4(address: string): Ipv4Bytes | null {
  if (net.isIPv4(address) === false) return null;
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  return parts.length === 4 ? (parts as Ipv4Bytes) : null;
}

/** Parse an IPv6 address (including embedded dotted-quad forms) into 16 bytes. */
function parseIpv6(address: string): number[] | null {
  const withoutZone = address.split('%')[0] ?? '';
  if (!net.isIPv6(withoutZone)) return null;

  let text = withoutZone.toLowerCase();
  // Convert a trailing dotted-quad (e.g. ::ffff:127.0.0.1) into two hex groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const [head = '', rest] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  let tailGroups: string[] = [];
  if (rest) tailGroups = rest.split(':');
  const missing = 8 - headGroups.length - tailGroups.length;
  if (rest === undefined ? missing !== 0 : missing < 0) return null;
  const fillCount = rest === undefined ? 0 : missing;
  const groups = [...headGroups, ...new Array<string>(fillCount).fill('0'), ...tailGroups];

  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

/**
 * IPv4 ranges that must never be reachable from outbound webhooks: "this"
 * network, private, CGNAT, loopback, link-local, IETF protocol assignments,
 * documentation, benchmarking, multicast, reserved, and broadcast.
 */
function isDisallowedIpv4([a, b, c]: Ipv4Bytes): boolean {
  // 0/8 "this" network, 10/8, 127/8 loopback, 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  switch (a) {
    case 100:
      return b >= 64 && b <= 127; // 100.64/10 CGNAT
    case 169:
      return b === 254; // 169.254/16 link-local
    case 172:
      return b >= 16 && b <= 31; // 172.16/12
    case 192:
      // 192.168/16, 192.0.0/24, 192.0.2/24
      return b === 168 || (b === 0 && (c === 0 || c === 2));
    case 198:
      // 198.18/15 benchmarking, 198.51.100/24
      return b === 18 || b === 19 || (b === 51 && c === 100);
    case 203:
      return b === 0 && c === 113; // 203.0.113/24
    default:
      return false;
  }
}

/**
 * IPv6 ranges that embed an IPv4 address (IPv4-mapped, SIIT, NAT64, 6to4).
 * Returns undefined when the address is not in one of those ranges.
 */
function isDisallowedEmbeddedIpv6(bytes: number[]): boolean | undefined {
  const zeroPrefix = (length: number) => bytes.slice(0, length).every((byte) => byte === 0);
  const embeddedV4 = (offset: number): Ipv4Bytes => [
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  ];
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;

  // ::ffff:0:0/96 IPv4-mapped.
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isDisallowedIpv4(embeddedV4(12));
  }
  // ::ffff:0:0:0/96 IPv4-translated (SIIT).
  if (
    zeroPrefix(8) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0
  ) {
    return isDisallowedIpv4(embeddedV4(12));
  }
  // 64:ff9b::/96 well-known NAT64 prefix.
  if (b0 === 0x00 && b1 === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (bytes.slice(4, 12).every((byte) => byte === 0)) return isDisallowedIpv4(embeddedV4(12));
    // 64:ff9b:1::/48 local-use NAT64 is site-specific.
    return bytes[4] === 0 && bytes[5] === 1;
  }
  // 2002::/16 6to4 embeds an IPv4 address in bytes 2-5.
  if (b0 === 0x20 && b1 === 0x02) return isDisallowedIpv4(embeddedV4(2));
  return undefined;
}

function isDisallowedIpv6(bytes: number[]): boolean {
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;

  // ::/96 covers ::, ::1 and deprecated IPv4-compatible addresses.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return true;
  const embedded = isDisallowedEmbeddedIpv6(bytes);
  if (embedded !== undefined) return embedded;
  // 2001:0::/32 Teredo (obfuscated embedded address) and 2001:db8::/32 documentation.
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0 && bytes[3] === 0) return true;
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  // 100::/64 discard-only.
  if (b0 === 0x01 && b1 === 0x00 && bytes.slice(2, 8).every((byte) => byte === 0)) return true;
  if ((b0 & 0xfe) === 0xfc) return true; // fc00::/7 ULA
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  return b0 === 0xff; // ff00::/8 multicast
}

/**
 * Whether an IP address literal (IPv4 or IPv6, with or without brackets) is
 * loopback, private, link-local, or otherwise not a public unicast address.
 * Non-IP input returns true so callers fail closed.
 */
export function isDisallowedIpAddress(address: string): boolean {
  const normalized = address.trim().replace(/^\[/, '').replace(/\]$/, '');
  const v4 = parseIpv4(normalized);
  if (v4) return isDisallowedIpv4(v4);
  const v6 = parseIpv6(normalized);
  if (v6) return isDisallowedIpv6(v6);
  return true;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '');
  if (!normalized) return true;
  if (
    LOCAL_HOSTNAMES.has(normalized) ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.localhost')
  ) {
    return true;
  }

  if (net.isIP(normalized.split('%')[0] ?? '') !== 0) return isDisallowedIpAddress(normalized);

  return false;
}

function validateUrlWithPolicy(
  rawUrl: string,
  policy: UrlValidationPolicy,
  options: ValidateUrlOptions = {},
): string {
  const fieldName = options.fieldName ?? 'url';
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new SecurityPolicyError(`${fieldName} is required`);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SecurityPolicyError(`${fieldName} must be a valid URL`);
  }

  const allowedProtocols = policy.allowHttp ? ['http:', 'https:'] : ['https:'];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new SecurityPolicyError(
      `${fieldName} must use ${policy.allowHttp ? 'http or https' : 'https'} protocol`,
    );
  }

  if (url.username || url.password) {
    throw new SecurityPolicyError(`${fieldName} must not include embedded credentials`);
  }

  if (!policy.allowPrivateHosts && isLocalOrPrivateHost(url.hostname)) {
    throw new SecurityPolicyError(`${fieldName} cannot target localhost or a private network`);
  }

  return url.toString();
}

export function validateWebhookUrl(rawUrl: string, options: ValidateUrlOptions = {}): string {
  return validateUrlWithPolicy(rawUrl, { allowHttp: false, allowPrivateHosts: false }, options);
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolve a webhook hostname and reject it if ANY resolved address is
 * loopback/private/link-local/etc. IP literals are checked without DNS.
 */
export async function resolvePublicAddresses(
  hostname: string,
  options: ValidateUrlOptions = {},
): Promise<ResolvedAddress[]> {
  const fieldName = options.fieldName ?? 'url';
  const bare = hostname.replace(/^\[/, '').replace(/\]$/, '');
  const literalFamily = net.isIP(bare);

  let addresses: ResolvedAddress[];
  if (literalFamily !== 0) {
    addresses = [{ address: bare, family: literalFamily as 4 | 6 }];
  } else {
    let results: dns.LookupAddress[];
    try {
      results = await dns.promises.lookup(bare, { all: true, verbatim: true });
    } catch {
      throw new SecurityPolicyError(`${fieldName} host could not be resolved`);
    }
    addresses = results.map((entry) => ({
      address: entry.address,
      family: entry.family === 6 ? 6 : 4,
    }));
  }

  if (addresses.length === 0) {
    throw new SecurityPolicyError(`${fieldName} host could not be resolved`);
  }
  if (addresses.some((entry) => isDisallowedIpAddress(entry.address))) {
    throw new SecurityPolicyError(`${fieldName} resolves to localhost or a private network`);
  }
  return addresses;
}

/** A `net.connect` lookup that only ever returns the pre-validated addresses. */
export function createPinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const family = typeof options === 'object' ? options.family : options;
    const candidates =
      family === 4 || family === 6
        ? addresses.filter((entry) => entry.family === family)
        : [...addresses];
    const first = candidates[0];
    if (!first) {
      const err: NodeJS.ErrnoException = new Error('No validated address for requested family');
      err.code = 'ENOTFOUND';
      callback(err, '', 0);
      return;
    }
    if (typeof options === 'object' && options.all) {
      (callback as unknown as (err: null, addrs: ResolvedAddress[]) => void)(null, candidates);
      return;
    }
    callback(null, first.address, first.family);
  };
}

export interface PinnedWebhookTarget {
  /** Normalized URL to fetch. */
  url: string;
  /** Dispatcher whose connections can only reach the validated addresses. */
  dispatcher: Agent;
}

/**
 * Validate a webhook URL, resolve its host, reject private destinations, and
 * return an undici dispatcher pinned to the validated addresses so the request
 * cannot re-resolve (DNS rebinding) to an internal address. Callers must
 * `close()` the dispatcher when done.
 */
export async function resolvePinnedWebhookTarget(
  rawUrl: string,
  options: ValidateUrlOptions = {},
): Promise<PinnedWebhookTarget> {
  const url = validateWebhookUrl(rawUrl, options);
  const addresses = await resolvePublicAddresses(new URL(url).hostname, options);
  const dispatcher = new Agent({ connect: { lookup: createPinnedLookup(addresses) } });
  return { url, dispatcher };
}

export function validateArrInstanceUrl(
  rawUrl: string,
  skipSslVerify?: boolean,
  options: ValidateUrlOptions = {},
): string {
  const normalizedUrl = validateUrlWithPolicy(
    rawUrl,
    { allowHttp: true, allowPrivateHosts: true },
    options,
  );
  assertSkipSslVerifyAllowed(normalizedUrl, skipSslVerify);
  return normalizedUrl;
}

export function assertSkipSslVerifyAllowed(url: string, skipSslVerify?: boolean): void {
  if (!skipSslVerify) return;
  if (new URL(url).protocol !== 'https:') {
    throw new SecurityPolicyError('skipSslVerify can only be enabled for https URLs');
  }
}

export function customScriptsEnabled(): boolean {
  return process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'] === 'true';
}

export function assertCustomScriptsEnabled(feature = 'Custom script execution'): void {
  if (customScriptsEnabled()) return;
  throw new SecurityPolicyError(`${feature} is disabled unless FILTARR_ENABLE_CUSTOM_SCRIPTS=true`);
}

/**
 * Remove trailing slashes from a URL string without using a regex
 * susceptible to polynomial backtracking (ReDoS).
 */
export function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') {
    end--;
  }
  return end === url.length ? url : url.slice(0, end);
}
