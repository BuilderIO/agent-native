import {
  pendingVisualStyleUndoTargets,
  type PendingVisualStyleUndoEntry,
} from "./pending-edits";

interface StyleEditKey {
  screenId: string;
  selector: string;
  updatedAt: number;
}

export function retainPendingVisualStyleUndoTargets(
  entry: PendingVisualStyleUndoEntry,
  included: ReadonlySet<string>,
): PendingVisualStyleUndoEntry | undefined {
  const targets = pendingVisualStyleUndoTargets(entry);
  const kept = targets.filter(
    (target) => !included.has(styleEditId(target.edit)),
  );
  if (kept.length === 0) return undefined;
  if (kept.length === targets.length) return entry;

  const [head, ...groupedTargets] = kept;
  return {
    ...entry,
    edit: head!.edit,
    revertStyles: head!.revertStyles,
    ...(groupedTargets.length > 0
      ? { groupedTargets }
      : { groupedTargets: undefined }),
  };
}

export function countRemovedPendingStyleEntries(
  entries: PendingVisualStyleUndoEntry[],
  included: ReadonlySet<string>,
): number {
  return entries.filter((entry) => {
    const targets = pendingVisualStyleUndoTargets(entry);
    return targets.every((target) => included.has(styleEditId(target.edit)));
  }).length;
}

function styleEditId(edit: StyleEditKey): string {
  return `style:${edit.screenId}:${edit.selector}:${edit.updatedAt}`;
}
