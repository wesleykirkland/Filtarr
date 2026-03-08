import path from 'node:path';
import type { FilterRow } from '../../db/schemas/filters.js';

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
