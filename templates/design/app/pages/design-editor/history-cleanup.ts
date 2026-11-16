interface StyleEditKey {
  screenId: string;
  selector: string;
  updatedAt: number;
}

interface PendingStyleEntry {
  edit: StyleEditKey;
  groupedTargets?: Array<{ edit: StyleEditKey }>;
}

export function countRemovedPendingStyleEntries(
  entries: PendingStyleEntry[],
  included: ReadonlySet<string>,
): number {
  return entries.filter((entry) => {
    const targets = entry.groupedTargets ?? [entry];
    return targets.some((target) => included.has(styleEditId(target.edit)));
  }).length;
}

function styleEditId(edit: StyleEditKey): string {
  return `style:${edit.screenId}:${edit.selector}:${edit.updatedAt}`;
}
