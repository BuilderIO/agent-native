export interface RecentPromptEntry {
  id: number;
  ownerEmail: string;
  app: string;
  label: string;
  model: string;
  prompt: string | null;
}

export function groupRecentPrompts<T extends RecentPromptEntry>(
  entries: readonly T[],
): Array<{ entry: T; count: number }> {
  const groups = new Map<string, { entry: T; count: number }>();
  for (const entry of entries) {
    const key =
      entry.prompt === null
        ? JSON.stringify(["uncaptured", entry.id])
        : JSON.stringify([
            entry.ownerEmail.toLowerCase(),
            entry.app,
            entry.label,
            entry.model,
            entry.prompt,
          ]);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { entry, count: 1 });
  }
  return [...groups.values()];
}
