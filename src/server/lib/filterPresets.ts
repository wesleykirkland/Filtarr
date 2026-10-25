export interface FilterPreset {
  id: string;
  name: string;
  description: string;
  ruleType: 'extension' | 'regex' | 'size' | 'script';
  rulePayload: string;
  actionType: 'blocklist' | 'delete' | 'move' | 'script';
  actionPayload?: string;
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'block_exe',
    name: 'Block EXE/MSI Files',
    description: 'Automatically blocklists releases containing .exe or .msi files.',
    ruleType: 'extension',
    rulePayload: 'exe, msi',
    actionType: 'blocklist',
  },
  {
    id: 'clean_samples',
    name: 'Delete Sample Videos',
    description:
      'Deletes video files whose name ends in "sample" as a separate word right before the extension ' +
      '(e.g. "movie-sample.mkv", "Movie.2020.sample.mp4", "sample.mkv"). Matches by name only; file size is not checked.',
    ruleType: 'regex',
    // Case-insensitive at evaluation time. "sample" must be the last token before a video
    // extension, so titles like "The.Sample.2020.mkv" or "Samples.mkv" are not matched.
    rulePayload: String.raw`(^|[.\-_ ])sample\.(mkv|mp4|m4v|avi|mov|wmv|ts|webm)$`,
    actionType: 'delete',
  },
  {
    id: 'block_iso',
    name: 'Block ISO/Disk Images',
    description: 'Blocklists releases that contain .iso or .img disk images.',
    ruleType: 'extension',
    rulePayload: 'iso, img',
    actionType: 'blocklist',
  },
  {
    id: 'garbage_cleaner',
    name: 'Clean Metadata Garbage',
    description:
      'Deletes common metadata junk files like .txt, .nfo (if not wanted), and .url files.',
    ruleType: 'extension',
    rulePayload: 'txt, nfo, url',
    actionType: 'delete',
  },
];
