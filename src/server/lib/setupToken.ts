import crypto from 'node:crypto';
import { logger } from './logger.js';

/**
 * One-time token that must be presented to POST /api/v1/setup/complete.
 *
 * Before setup completes the instance has no credentials, so without this token the first
 * client to reach the port could claim it. The token lives only in memory (or comes from
 * FILTARR_SETUP_TOKEN) and is printed to the server log on startup.
 */
let generatedToken: string | null = null;

function envToken(): string | undefined {
  const value = process.env['FILTARR_SETUP_TOKEN']?.trim();
  return value || undefined;
}

/** Current setup token: FILTARR_SETUP_TOKEN if set, otherwise a lazily generated random token. */
export function getSetupToken(): string {
  const fromEnv = envToken();
  if (fromEnv) return fromEnv;
  generatedToken ??= crypto.randomBytes(32).toString('hex');
  return generatedToken;
}

/** Constant-time comparison of a client-supplied token against the current setup token. */
export function verifySetupToken(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  // Hash both sides so timingSafeEqual always compares equal-length buffers.
  const expected = crypto.createHash('sha256').update(getSetupToken()).digest();
  const provided = crypto.createHash('sha256').update(candidate.trim()).digest();
  return crypto.timingSafeEqual(expected, provided);
}

/** Discard the generated token once setup has completed so it cannot be reused. */
export function clearSetupToken(): void {
  generatedToken = null;
}

/** Log the setup token with a prominent banner (called on startup while setup is pending). */
export function logSetupTokenBanner(): void {
  const token = getSetupToken();
  const source = envToken() ? ' (from FILTARR_SETUP_TOKEN)' : '';
  const bar = '='.repeat(72);
  logger.info(
    `\n${bar}\nFiltarr has not been set up yet.\nInitial setup token${source}: ${token}\nEnter it in the setup wizard to finish setup.\n${bar}`,
  );
}

/** Test helper: read the current setup token. Unavailable in production. */
export function getSetupTokenForTests(): string {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('getSetupTokenForTests is not available in production');
  }
  return getSetupToken();
}
