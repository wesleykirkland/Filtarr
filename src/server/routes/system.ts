import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { routerRateLimiter } from '../middleware/requestPolicy.js';

export const publicSystemRoutes = Router();
export const protectedSystemRoutes = Router();
protectedSystemRoutes.use(routerRateLimiter());

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
export const BLOCKED_BROWSE_PATHS: readonly string[] = ['/proc', '/sys', '/dev'];

// Root directory that the filesystem browser is allowed to access.
// This should be configured to a non-sensitive directory in production.
function getBrowseRoot(): string {
  return process.env['FILTARR_BROWSE_ROOT'] || '/';
}

/** Whether the browse root has been explicitly restricted via FILTARR_BROWSE_ROOT. */
export function isBrowseRootConfigured(): boolean {
  return Boolean(process.env['FILTARR_BROWSE_ROOT']);
}

export function isContainedIn(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}

/**
 * Resolve symlinks for the deepest existing ancestor of `target`, then re-append
 * the non-existent remainder. Lets us root-check paths that don't exist yet.
 */
export function realpathOfNearestAncestor(target: string): string {
  let current = target;
  const remainder: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...remainder);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      remainder.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Check whether an absolute path (which need not exist) lies within the browse root.
 * Used to keep watched directories inside FILTARR_BROWSE_ROOT.
 */
export function isPathWithinBrowseRoot(targetPath: string): boolean {
  const root = realpathOfNearestAncestor(path.resolve(getBrowseRoot()));
  const candidate = realpathOfNearestAncestor(path.resolve(targetPath));
  return isContainedIn(candidate, root);
}

function sanitizeBrowsePath(requestedPath: string): string | null {
  const browseRoot = getBrowseRoot();
  // Resolve against the allowed root directory
  const candidate = path.resolve(browseRoot, requestedPath);

  let realPath: string;
  try {
    realPath = fs.realpathSync(candidate);
  } catch {
    // Path does not exist or cannot be resolved
    return null;
  }

  // Ensure the real path is contained within the browse root
  const normalizedRoot = fs.realpathSync(browseRoot);
  if (!isContainedIn(realPath, normalizedRoot)) {
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
protectedSystemRoutes.get('/browse', (req: Request, res: Response, next: NextFunction) => {
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

    // No parent at the browse root: the directory above it is outside the root and would 403.
    const atRoot = resolved === fs.realpathSync(getBrowseRoot()) || resolved === path.dirname(resolved);
    res.json({
      current: resolved,
      parent: atRoot ? null : path.dirname(resolved),
      entries: dirs,
    });
  } catch (err) {
    // errorHandler logs the detail and returns a generic 500 without leaking fs error text.
    next(err);
  }
});
