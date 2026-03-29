import net from 'node:net';

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

function isPrivateIpv4(hostname: string): boolean {
  const [a, b] = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  if (a === undefined || b === undefined) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized)
  );
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
  if (!normalized) return true;
  if (LOCAL_HOSTNAMES.has(normalized) || normalized.endsWith('.local')) return true;

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isPrivateIpv6(normalized);

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
  throw new SecurityPolicyError(
    `${feature} is disabled unless FILTARR_ENABLE_CUSTOM_SCRIPTS=true`,
  );
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