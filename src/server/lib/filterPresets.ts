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
    actionPayload: 'blocklist_and_search',
  },
  {
    id: 'clean_samples',
    name: 'Delete Small Samples',
    description:
      'Deletes small video files that are likely samples (e.g. < 200MB and contains "sample").',
    ruleType: 'regex',
    rulePayload: '.*sample.*',
    actionType: 'delete',
  },
  {
    id: 'block_iso',
    name: 'Block ISO/Disk Images',
    description: 'Blocklists releases that contain .iso or .img disk images.',
    ruleType: 'extension',
    rulePayload: 'iso, img',
    actionType: 'blocklist',
    actionPayload: 'blocklist_and_search',
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
