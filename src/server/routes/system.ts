import { Router } from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const publicSystemRoutes = Router();
export const protectedSystemRoutes = Router();

function realpathSyncNative(value: string): string {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function getPlatformComparablePath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
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

// GET /api/v1/system/browse?path=/some/dir
// Returns subdirectories at the given path for the filesystem picker UI
protectedSystemRoutes.get('/browse', (req, res) => {
  try {
    const requestedPath = (req.query['path'] as string) || '/';

    // Reject null bytes (path traversal attempt)
    if (requestedPath.includes('\0')) {
      res.status(400).json({ error: 'Invalid path: contains null bytes' });
      return;
    }

    const candidate = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve('/', requestedPath);

    // Resolve symbolic links to get the canonical path
    let resolved: string;
    try {
      // lgtm[js/path-injection]
      // codeql[js/path-injection]
      // The candidate path has had null bytes rejected above and is resolved to an absolute path.
      resolved = realpathSyncNative(candidate);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({ error: 'Path does not exist' });
        return;
      }
      res.status(400).json({ error: 'Path cannot be accessed' });
      return;
    }

    const forbiddenError = getWindowsForbiddenError(resolved);
    if (forbiddenError) {
      res.status(400).json({ error: forbiddenError });
      return;
    }

    // Use try/catch to avoid TOCTOU race condition
    let stat;
    try {
      // lgtm[js/path-injection]
      // codeql[js/path-injection]
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

    // lgtm[js/path-injection]
    // codeql[js/path-injection]
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
        isDir: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(resolved);
    const parent = resolved !== parentPath ? parentPath : null;

    res.json({ current: resolved, parent, entries: dirs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Browse failed' });
  }
});
