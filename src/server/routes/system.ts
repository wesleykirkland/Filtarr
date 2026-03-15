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

  const resolvedRoots = roots.map((root) => path.resolve(root));
  const canonicalRoots = resolvedRoots.map((root) => {
    try {
      return fs.realpathSync.native ? fs.realpathSync.native(root) : fs.realpathSync(root);
    } catch {
      return root;
    }
  });

  // If an absolute path is provided, treat it as-is; otherwise resolve relative to the first root.
  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(resolvedRoots[0] ?? path.parse(process.cwd()).root, requestedPath);

  // Resolve any symbolic links and get the canonical path, if possible.
  // If the path doesn't exist, we'll use the candidate path and let the
  // route handler return a proper 404 error.
  let normalized: string;
  try {
    normalized = fs.realpathSync.native
      ? fs.realpathSync.native(candidate)
      : fs.realpathSync(candidate);
  } catch (err) {
    // If ENOENT (path doesn't exist), allow validation to continue
    // so the route handler can return a proper 404 error
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Canonicalize the missing path based on the nearest existing ancestor so
      // allowlist checks still work on platforms where /var is a symlink to /private/var.
      let cursor = candidate;
      while (true) {
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        try {
          const parentReal = fs.realpathSync.native ? fs.realpathSync.native(parent) : fs.realpathSync(parent);
          const suffix = path.relative(parent, candidate);
          normalized = path.join(parentReal, suffix);
          break;
        } catch (parentErr) {
          if ((parentErr as NodeJS.ErrnoException).code !== 'ENOENT') break;
          cursor = parent;
        }
      }

      if (!normalized) normalized = candidate;
    } else {
      // For other errors (permission denied, etc.), treat as invalid
      return { valid: false, error: 'Path cannot be accessed' };
    }
  }

  // Ensure the normalized path stays within one of the allowed root directories.
  const normalizedForCompare = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  const allowedIndex = canonicalRoots.findIndex((root) => {
    const rootForCompare = process.platform === 'win32' ? root.toLowerCase() : root;
    return isWithinRoot(rootForCompare, normalizedForCompare);
  });
  const allowedRoot = allowedIndex === -1 ? null : canonicalRoots[allowedIndex];
  if (!allowedRoot) {
    return { valid: false, error: 'Access outside the allowed root directories is not permitted' };
  }

  // On Windows, ensure we're not accessing sensitive system paths even within the root.
  if (process.platform === 'win32') {
    const lowerNormalized = normalizedForCompare;
    const forbidden = [
      String.raw`c:\windows\system32`,
      String.raw`c:\windows\syswow64`,
      String.raw`c:\program files`,
    ];
    if (forbidden.some((f) => lowerNormalized.startsWith(f))) {
      return { valid: false, error: 'Access to system directories is not allowed' };
    }
  }

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

    res.json({
      current: resolved,
      parent: resolved === root ? '/' : isWithinRoot(root, path.dirname(resolved)) ? path.dirname(resolved) : '/',
      entries: dirs,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Browse failed' });
  }
});
