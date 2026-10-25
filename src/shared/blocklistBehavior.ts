/**
 * Per-filter "Arr Behavior" for the `blocklist` action, stored in
 * `filters.action_payload`. Shared between server and client so both sides
 * agree on the allowed values.
 *
 * - blocklist_and_search: blocklist the release and let the Arr re-search
 *   for a replacement (Arr-native redownload).
 * - blocklist_only: blocklist the release, skip the redownload.
 * - remove_only: remove from the queue/client without blocklisting. The Arr
 *   may grab the same release again.
 */
export const BLOCKLIST_BEHAVIORS = ['blocklist_and_search', 'blocklist_only', 'remove_only'] as const;

export type BlocklistBehavior = (typeof BLOCKLIST_BEHAVIORS)[number];

export const DEFAULT_BLOCKLIST_BEHAVIOR: BlocklistBehavior = 'blocklist_and_search';

export function isBlocklistBehavior(value: unknown): value is BlocklistBehavior {
  return typeof value === 'string' && (BLOCKLIST_BEHAVIORS as readonly string[]).includes(value);
}
