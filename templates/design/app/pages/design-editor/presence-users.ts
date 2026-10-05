import type { CollabUser } from "@agent-native/core/client/collab";

/** One avatar per person, even when they appear in more than one presence list. */
export function mergePresenceUsers(
  ...lists: ReadonlyArray<readonly CollabUser[] | undefined>
): CollabUser[] {
  const seen = new Set<string>();
  const merged: CollabUser[] = [];
  for (const user of lists.flatMap((list) => list ?? [])) {
    const key = user.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(user);
  }
  return merged;
}
