import { Router } from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const publicSystemRoutes = Router();
export const protectedSystemRoutes = Router();

// Base directory that filesystem browsing is allowed to access.
// Default to the filesystem root, but allow overriding via environment variable.
// All browsed paths must stay within this directory.
const BROWSE_ROOT = process.env['FILTARR_BROWSE_ROOT']
  ? path.resolve(process.env['FILTARR_BROWSE_ROOT'])
  : path.parse(process.cwd()).root;

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
 * The resulting path must stay within BROWSE_ROOT and not contain suspicious patterns.
 */
function validateBrowsePath(requestedPath: string): { valid: boolean; error?: string; normalized?: string } {
  // Reject empty or non-string paths
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { valid: false, error: 'Path must be a non-empty string' };
  }

  // Interpret the requested path as relative to BROWSE_ROOT to prevent escaping
  // using ".." segments or absolute paths supplied by the user.
  const candidate = path.resolve(BROWSE_ROOT, requestedPath);

  // Reject paths that contain null bytes (path traversal attempt)
  if (candidate.includes('\0')) {
    return { valid: false, error: 'Invalid path: contains null bytes' };
  }

  // Resolve any symbolic links and get the canonical path, if possible.
  let normalized: string;
  try {
    normalized = fs.realpathSync.native
      ? fs.realpathSync.native(candidate)
      : fs.realpathSync(candidate);
  } catch {
    // If the path cannot be resolved, treat it as invalid for browsing.
    return { valid: false, error: 'Path does not exist or cannot be resolved' };
  }

  // Ensure the normalized path stays within the allowed root directory.
  const rootForCompare = process.platform === 'win32' ? BROWSE_ROOT.toLowerCase() : BROWSE_ROOT;
  const normalizedForCompare = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  if (!normalizedForCompare.startsWith(rootForCompare)) {
    return { valid: false, error: 'Access outside the allowed root directory is not permitted' };
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

  return { valid: true, normalized };
}

// GET /api/v1/system/browse?path=/some/dir
// Returns subdirectories at the given path for the filesystem picker UI
protectedSystemRoutes.get('/browse', (req, res) => {
  try {
    const requestedPath = (req.query['path'] as string) || '/';

    // Validate the path before using it
    const validation = validateBrowsePath(requestedPath);
    if (!validation.valid || !validation.normalized) {
      res.status(400).json({ error: validation.error || 'Invalid path' });
      return;
    }

    const resolved = validation.normalized;

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
      parent: resolved === '/' ? null : path.dirname(resolved),
      entries: dirs,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Browse failed' });
  }
});
