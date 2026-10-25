/**
 * Vitest setup file: runs before every test file.
 *
 * Gives each test file its own throwaway FILTARR_DATA_DIR so tests never
 * touch the developer's ./data/filtarr.db and parallel workers never contend
 * for the same SQLite file ("database is locked").
 *
 * The config (`_config`) and database (`_db`) singletons do not need explicit
 * resets here: vitest isolates the module graph per test file, so every file
 * starts with fresh singletons that read the env var set below. This file
 * deliberately does not import app modules, so `vi.mock()` calls in test files
 * still apply to them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach } from 'vitest';

const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-test-'));

// Set before the test file is imported so module-level getDatabase()/createApp()
// calls resolve to the isolated directory.
process.env['FILTARR_DATA_DIR'] = isolatedDataDir;

// Some tests point FILTARR_DATA_DIR elsewhere and `delete` it on teardown.
// Restore the isolated directory so later tests in the same file never fall
// back to the default ./data. This hook runs before the file's own beforeEach
// hooks, so tests that deliberately unset or override the variable still win.
beforeEach(() => {
  process.env['FILTARR_DATA_DIR'] ??= isolatedDataDir;
});

afterAll(() => {
  fs.rmSync(isolatedDataDir, { recursive: true, force: true });
});
