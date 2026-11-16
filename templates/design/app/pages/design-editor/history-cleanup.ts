import type { PendingHistoryOrderEntry } from "./editor-state";
import type { UndoRedoOrderKind } from "./editor-state";
import { firstArrayValue } from "./editor-state";
import {
  pendingVisualStyleUndoTargets,
  type PendingVisualStyleUndoEntry,
  type PendingVisualStyleUndoTarget,
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

  const head: PendingVisualStyleUndoTarget | undefined = firstArrayValue(kept);
  if (!head) return undefined;
  const groupedTargets = kept.slice(1);
  const {
    groupedTargets: _previousGroupedTargets,
    ...entryWithoutGroupedTargets
  } = entry;
  return {
    ...entryWithoutGroupedTargets,
    edit: head.edit,
    revertStyles: head.revertStyles,
    ...(groupedTargets.length > 0 ? { groupedTargets } : {}),
  };
}

export function removedPendingVisualStyleHistoryEntries(
  entries: PendingVisualStyleUndoEntry[],
  included: ReadonlySet<string>,
): PendingHistoryOrderEntry[] {
  return entries.flatMap((entry) => {
    const targets = pendingVisualStyleUndoTargets(entry);
    return targets.every((target) => included.has(styleEditId(target.edit))) &&
      entry.historyOrderEntry
      ? [entry.historyOrderEntry]
      : [];
  });
}

export function removePendingHistoryOrderEntries(
  order: UndoRedoOrderKind[],
  removedEntries: ReadonlySet<string>,
): UndoRedoOrderKind[] {
  return order.filter(
    (entry) => typeof entry === "string" || !removedEntries.has(entry.id),
  );
}

function styleEditId(edit: StyleEditKey): string {
  return `style:${edit.screenId}:${edit.selector}:${edit.updatedAt}`;
}
