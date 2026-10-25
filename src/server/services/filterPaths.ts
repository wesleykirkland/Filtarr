import path from 'node:path';
import { getConfig } from '../../config/index.js';
import type { FilterRow } from '../../db/schemas/filters.js';
import {
  BLOCKED_BROWSE_PATHS,
  isBrowseRootConfigured,
  isContainedIn,
  isPathWithinBrowseRoot,
  realpathOfNearestAncestor,
} from '../routes/system.js';

/**
 * System directories that filter target/destination paths may never be, nor live under.
 */
export const BLOCKED_FILTER_PATH_TREES: readonly string[] = [
  ...new Set([
    ...BLOCKED_BROWSE_PATHS,
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/proc',
    '/sys',
    '/dev',
    '/boot',
  ]),
];

/**
 * Directories a filter path may never be exactly. Descendants stay allowed because
 * media commonly lives below them (e.g. /var/lib/..., /root/downloads).
 */
export const BLOCKED_FILTER_PATHS_EXACT: readonly string[] = ['/', '/var', '/root'];

function getDataDir(): string | null {
  try {
    return path.resolve(getConfig().dataDir);
  } catch {
    return null;
  }
}

function isBlockedFilterLocation(candidate: string): boolean {
  if (BLOCKED_FILTER_PATHS_EXACT.includes(candidate)) return true;
  if (BLOCKED_FILTER_PATH_TREES.some((blocked) => isContainedIn(candidate, blocked))) return true;

  const dataDir = getDataDir();
  if (dataDir) {
    for (const dir of new Set([dataDir, realpathOfNearestAncestor(dataDir)])) {
      // Neither inside the data dir nor an ancestor of it (a delete filter there could wipe the DB).
      if (isContainedIn(candidate, dir) || isContainedIn(dir, candidate)) return true;
    }
  }
  return false;
}

/**
 * Returns a human-readable reason why `rawPath` may not be used as a filter target
 * or move destination, or null when it is acceptable. Symlinks in existing
 * ancestors are resolved so they cannot be used to escape the checks.
 */
export function getFilterPathViolation(rawPath: string, label = 'Path'): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return `${label} must be an absolute path`;

  const resolved = path.resolve(trimmed);
  const real = realpathOfNearestAncestor(resolved);
  if (isBlockedFilterLocation(resolved) || isBlockedFilterLocation(real)) {
    return `${label} cannot be the filesystem root, a system directory, or the Filtarr data directory`;
  }
  if (isBrowseRootConfigured() && !isPathWithinBrowseRoot(resolved)) {
    return `${label} must be inside FILTARR_BROWSE_ROOT`;
  }
  return null;
}

export function normalizeFilterTargetPath(targetPath: string | null | undefined): string | null {
  if (typeof targetPath !== 'string') return null;

  const trimmed = targetPath.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return null;

  return path.resolve(trimmed);
}

export function getWatcherPaths(filters: FilterRow[]): string[] {
  const watchedPaths = new Set<string>();

  for (const filter of filters) {
    if (filter.enabled !== 1) continue;
    if (filter.trigger_source !== 'watcher') continue;

    const targetPath = normalizeFilterTargetPath(filter.target_path);
    if (targetPath) watchedPaths.add(targetPath);
  }

  return [...watchedPaths];
}

export function isPathWithinTarget(filePath: string, targetPath: string): boolean {
  const normalizedTargetPath = normalizeFilterTargetPath(targetPath);
  if (!normalizedTargetPath) return false;

  const normalizedFilePath = path.resolve(filePath);
  const relativePath = path.relative(normalizedTargetPath, normalizedFilePath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
