import { Router } from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getConfig } from '../../config/index.js';

export const publicSystemRoutes = Router();
export const protectedSystemRoutes = Router();

function getBrowseRoots(): string[] {
  // Comma-separated allowlist of directory roots (recommended).
  // Backwards-compatible with FILTARR_BROWSE_ROOT (single root).
  const envRoots =
    process.env['FILTARR_BROWSE_ROOTS']?.trim() ||
    process.env['FILTARR_BROWSE_ROOT']?.trim() ||
    '';

  const parsed = envRoots
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  // Safe default: only allow browsing within the app data directory.
  const fallback = process.env['FILTARR_DATA_DIR']?.trim() || getConfig().dataDir;
  const roots = parsed.length > 0 ? parsed : [fallback];

  return roots.map((root) => path.resolve(root));
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  if (relative === '..') return false;
  if (relative.startsWith(`..${path.sep}`)) return false;
  return !path.isAbsolute(relative);
}

function realpathSyncNative(value: string): string {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function getPlatformComparablePath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function resolveBrowseRoots(roots: string[]): { resolvedRoots: string[]; canonicalRoots: string[] } {
  const resolvedRoots = roots.map((root) => path.resolve(root));
  const canonicalRoots = resolvedRoots.map((root) => {
    try {
      return realpathSyncNative(root);
    } catch {
      return root;
    }
  });
  return { resolvedRoots, canonicalRoots };
}

function resolveBrowseCandidate(requestedPath: string, defaultRoot: string): string {
  if (path.isAbsolute(requestedPath)) return path.resolve(requestedPath);
  return path.resolve(defaultRoot, requestedPath);
}

function canonicalizeMissingPath(candidate: string): string {
  // Canonicalize a non-existent path based on the nearest existing ancestor so allowlist
  // checks still work on platforms where /var is a symlink to /private/var.
  let cursor = candidate;
  while (true) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    try {
      const parentReal = realpathSyncNative(parent);
      const suffix = path.relative(parent, candidate);
      return path.join(parentReal, suffix);
    } catch {
      cursor = parent;
    }
  }

  return candidate;
}

function resolveNormalizedPath(candidate: string): { normalized: string } | { error: string } {
  try {
    return { normalized: realpathSyncNative(candidate) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { normalized: canonicalizeMissingPath(candidate) };
    }
    return { error: 'Path cannot be accessed' };
  }
}

function findAllowedRoot(normalized: string, canonicalRoots: string[]): string | null {
  const normalizedForCompare = getPlatformComparablePath(normalized);
  for (const root of canonicalRoots) {
    const rootForCompare = getPlatformComparablePath(root);
    if (isWithinRoot(rootForCompare, normalizedForCompare)) return root;
  }
  return null;
}

function getWindowsForbiddenError(normalized: string): string | null {
  if (process.platform !== 'win32') return null;

  const lowerNormalized = getPlatformComparablePath(normalized);
  const forbidden = [String.raw`c:\windows\system32`, String.raw`c:\windows\syswow64`, String.raw`c:\program files`];
  return forbidden.some((f) => lowerNormalized.startsWith(f)) ? 'Access to system directories is not allowed' : null;
}

// Read version from package.json
function getVersion(): string {
  const envVersion = process.env['FILTARR_VERSION']?.trim();
  if (envVersion) {
    return envVersion;
  }

  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Walk up to find package.json (works from src/ or dist/)
    const dirs = [path.resolve(__dirname, '../../..'), path.resolve(__dirname, '../..')];
    for (const dir of dirs) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
        return pkg.version;
      }
    }
  } catch {
    // ignore
  }
  return '0.0.0';
}

publicSystemRoutes.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: getVersion() });
});

/**
 * Validate that a path is safe to access (prevents directory traversal attacks).
 * The resulting path must stay within one of the allowed browse roots.
 */
function validateBrowsePath(
  requestedPath: string,
  roots: string[],
): { valid: boolean; error?: string; normalized?: string; root?: string } {
  // Reject empty or non-string paths
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { valid: false, error: 'Path must be a non-empty string' };
  }

  // Reject paths that contain null bytes (path traversal attempt)
  if (requestedPath.includes('\0')) {
    return { valid: false, error: 'Invalid path: contains null bytes' };
  }

  const { resolvedRoots, canonicalRoots } = resolveBrowseRoots(roots);
  const defaultRoot = resolvedRoots[0] ?? path.parse(process.cwd()).root;

  const candidate = resolveBrowseCandidate(requestedPath, defaultRoot);

  // Resolve any symbolic links and get the canonical path, if possible.
  // If the path doesn't exist, we'll use the candidate path and let the
  // route handler return a proper 404 error.
  const normalizedResult = resolveNormalizedPath(candidate);
  if ('error' in normalizedResult) {
    return { valid: false, error: normalizedResult.error };
  }
  const normalized = normalizedResult.normalized;

  // Ensure the normalized path stays within one of the allowed root directories.
  const allowedRoot = findAllowedRoot(normalized, canonicalRoots);
  if (!allowedRoot) {
    return { valid: false, error: 'Access outside the allowed root directories is not permitted' };
  }

  const forbiddenError = getWindowsForbiddenError(normalized);
  if (forbiddenError) return { valid: false, error: forbiddenError };

  return { valid: true, normalized, root: allowedRoot };
}

// GET /api/v1/system/browse?path=/some/dir
// Returns subdirectories at the given path for the filesystem picker UI
protectedSystemRoutes.get('/browse', (req, res) => {
  try {
    const requestedPath = (req.query['path'] as string) || '/';
    const roots = getBrowseRoots();

    // Virtual root: list allowed roots without touching the filesystem root.
    if (requestedPath === '/' || requestedPath.trim() === '') {
      const entries = roots
        .filter((root) => {
          try {
            return fs.statSync(root).isDirectory();
          } catch {
            return false;
          }
        })
        .map((root) => ({
          name: path.basename(root) || root,
          path: root,
          isDir: true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json({ current: '/', parent: null, entries });
      return;
    }

    // Validate the path before using it
    const validation = validateBrowsePath(requestedPath, roots);
    if (!validation.valid || !validation.normalized || !validation.root) {
      res.status(400).json({ error: validation.error || 'Invalid path' });
      return;
    }

    const resolved = validation.normalized;
    const root = validation.root;

    // Use try/catch to avoid TOCTOU race condition
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({ error: 'Path does not exist' });
        return;
      }
      throw err;
    }

    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
        isDir: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentCandidate = path.dirname(resolved);
    let parent = '/';
    if (resolved !== root && isWithinRoot(root, parentCandidate)) {
      parent = parentCandidate;
    }

    res.json({
      current: resolved,
      parent,
      entries: dirs,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Browse failed' });
  }
});
