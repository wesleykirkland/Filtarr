import { describe, expect, it } from 'vitest';
import { FILTER_PRESETS } from '../../src/server/lib/filterPresets.js';

describe('clean_samples preset', () => {
  const preset = FILTER_PRESETS.find((p) => p.id === 'clean_samples');
  if (!preset) throw new Error('clean_samples preset missing');
  // Mirrors FilterEngine regex evaluation: case-insensitive test against the file name.
  const matches = (name: string) => new RegExp(preset.rulePayload, 'i').test(name);

  it('matches common sample file names', () => {
    for (const name of [
      'sample.mkv',
      'movie-sample.mkv',
      'Movie.2020.1080p.SAMPLE.mp4',
      'show_s01e01_sample.avi',
      'Movie 2020 Sample.m4v',
    ]) {
      expect(matches(name), name).toBe(true);
    }
  });

  it('does not match titles or non-video files that merely contain "sample"', () => {
    for (const name of [
      'The.Sample.2020.mkv',
      'Samples.mkv',
      'Movie.2020.Resampled.mkv',
      'sample.txt',
      'movie-sample.nfo',
    ]) {
      expect(matches(name), name).toBe(false);
    }
  });

  it('does not promise a size check it does not perform', () => {
    expect(preset.ruleType).toBe('regex');
    expect(preset.description).not.toMatch(/200\s*MB/i);
  });
});
