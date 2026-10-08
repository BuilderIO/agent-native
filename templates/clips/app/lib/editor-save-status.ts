export type EditSaveKind = "trims" | "overlays";
export type EditorSaveStatus = "ready" | "saving" | "saved" | "error";

interface SaveKindLedger {
  generation: number;
  failedGeneration: number;
  successfulGeneration: number;
}

export interface EditorSaveLedger {
  pending: number;
  byKind: Record<EditSaveKind, SaveKindLedger>;
}

export interface EditorSaveQueue {
  tail: Promise<void>;
}

export function createEditorSaveQueue(): EditorSaveQueue {
  return { tail: Promise.resolve() };
}

export function enqueueEditorSave<T>(
  queue: EditorSaveQueue,
  save: () => Promise<T>,
): Promise<T> {
  const result = queue.tail.then(save);
  // Keep later writes runnable without changing this save's returned rejection.
  queue.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function createEditorSaveLedger(): EditorSaveLedger {
  const fresh = (): SaveKindLedger => ({
    generation: 0,
    failedGeneration: 0,
    successfulGeneration: 0,
  });

  return {
    pending: 0,
    byKind: { trims: fresh(), overlays: fresh() },
  };
}

export function beginEditorSave(
  ledger: EditorSaveLedger,
  kind: EditSaveKind,
): number {
  const save = ledger.byKind[kind];
  save.generation += 1;
  ledger.pending += 1;
  return save.generation;
}

export function isLatestEditorSave(
  ledger: EditorSaveLedger,
  kind: EditSaveKind,
  generation: number,
): boolean {
  return ledger.byKind[kind].generation === generation;
}

export function removeEditorHistoryEntry<T>(entries: T[], entry: T): T[] {
  const index = entries.lastIndexOf(entry);
  if (index < 0) return entries;
  return [...entries.slice(0, index), ...entries.slice(index + 1)];
}

export function finishEditorSave(
  ledger: EditorSaveLedger,
  kind: EditSaveKind,
  generation: number,
  succeeded: boolean,
): EditorSaveStatus {
  const save = ledger.byKind[kind];
  if (succeeded) {
    save.successfulGeneration = Math.max(save.successfulGeneration, generation);
  } else {
    save.failedGeneration = Math.max(save.failedGeneration, generation);
  }

  ledger.pending = Math.max(0, ledger.pending - 1);
  if (ledger.pending > 0) return "saving";
  return Object.values(ledger.byKind).some(
    (status) => status.failedGeneration > status.successfulGeneration,
  )
    ? "error"
    : "saved";
}
