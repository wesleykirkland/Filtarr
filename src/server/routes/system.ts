import { Router } from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const publicSystemRoutes = Router();
export const protectedSystemRoutes = Router();

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

// Paths that should never be browseable for security reasons
const BLOCKED_BROWSE_PATHS = ['/proc', '/sys', '/dev'];

// Root directory that the filesystem browser is allowed to access.
// This should be configured to a non-sensitive directory in production.
const BROWSE_ROOT = process.env['FILTARR_BROWSE_ROOT'] || '/';

function sanitizeBrowsePath(requestedPath: string): string | null {
  // Resolve against the allowed root directory
  const candidate = path.resolve(BROWSE_ROOT, requestedPath);

  let realPath: string;
  try {
    realPath = fs.realpathSync(candidate);
  } catch {
    // Path does not exist or cannot be resolved
    return null;
  }

  // Ensure the real path is contained within the browse root
  const normalizedRoot = fs.realpathSync(BROWSE_ROOT);
  if (
    realPath !== normalizedRoot &&
    !realPath.startsWith(normalizedRoot + path.sep)
  ) {
    return null;
  }

  // Block additional sensitive system directories, if they happen to be under the root
  for (const blocked of BLOCKED_BROWSE_PATHS) {
    if (realPath === blocked || realPath.startsWith(blocked + path.sep)) {
      return null;
    }
  }

  return realPath;
}

// GET /api/v1/system/browse?path=/some/dir
// Returns subdirectories at the given path for the filesystem picker UI
protectedSystemRoutes.get('/browse', (req, res) => {
  try {
    const requestedPath = (req.query['path'] as string) || '/';
    const resolved = sanitizeBrowsePath(requestedPath);

    if (!resolved) {
      res.status(403).json({ error: 'Access to this path is not allowed' });
      return;
    }

    const stat = fs.statSync(resolved);
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
