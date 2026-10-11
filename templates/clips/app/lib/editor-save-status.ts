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
  pending: number;
  failure: { reason: unknown } | null;
}

const recordingSaveQueues = new Map<
  string,
  Partial<Record<EditSaveKind, EditorSaveQueue>>
>();
interface RecordingEditorOperation {
  count: number;
  idle: Promise<void>;
  resolveIdle: () => void;
}

const recordingEditorOperations = new Map<string, RecordingEditorOperation>();

export function createEditorSaveQueue(): EditorSaveQueue {
  return { tail: Promise.resolve(), pending: 0, failure: null };
}

export function enqueueEditorSave<T>(
  queue: EditorSaveQueue,
  save: () => Promise<T>,
): Promise<T> {
  queue.pending += 1;
  const result = queue.tail.then(async () => {
    if (queue.failure) throw queue.failure.reason;
    try {
      return await save();
    } catch (reason) {
      // Later payloads may include this edit, so cancel the rest of this batch.
      queue.failure = { reason };
      throw reason;
    }
  });
  // Drain the failed batch before letting a fresh user edit start.
  const settle = () => {
    queue.pending -= 1;
    if (queue.pending === 0) queue.failure = null;
  };
  queue.tail = result.then(settle, settle);
  return result;
}

export function enqueueRecordingEditorSave<T>(
  recordingId: string,
  kind: EditSaveKind,
  save: () => Promise<T>,
): Promise<T> {
  let queues = recordingSaveQueues.get(recordingId);
  if (!queues) {
    queues = {};
    recordingSaveQueues.set(recordingId, queues);
  }

  let queue = queues[kind];
  if (!queue) {
    queue = createEditorSaveQueue();
    queues[kind] = queue;
  }

  const result = enqueueEditorSave(queue, save);
  const removeIfIdle = () => {
    if (queue.pending !== 0) return;
    const currentQueues = recordingSaveQueues.get(recordingId);
    if (currentQueues?.[kind] !== queue) return;
    delete currentQueues[kind];
    if (Object.keys(currentQueues).length === 0) {
      recordingSaveQueues.delete(recordingId);
    }
  };
  void result.then(removeIfIdle, removeIfIdle);
  return result;
}

export function hasPendingRecordingEditorSaves(recordingId: string): boolean {
  return (
    Boolean(recordingEditorOperations.get(recordingId)?.count) ||
    Object.values(recordingSaveQueues.get(recordingId) ?? {}).some(
      (queue) => queue?.pending,
    )
  );
}

export function beginRecordingEditorOperation(recordingId: string): () => void {
  let operation = recordingEditorOperations.get(recordingId);
  if (!operation) {
    let resolveIdle!: () => void;
    const idle = new Promise<void>((resolve) => {
      resolveIdle = resolve;
    });
    operation = { count: 0, idle, resolveIdle };
    recordingEditorOperations.set(recordingId, operation);
  }
  operation.count += 1;

  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    operation!.count -= 1;
    if (operation!.count > 0) return;
    recordingEditorOperations.delete(recordingId);
    operation!.resolveIdle();
  };
}

export async function waitForRecordingEditorSaves(
  recordingId: string,
): Promise<void> {
  while (true) {
    const queues = Object.values(recordingSaveQueues.get(recordingId) ?? {});
    const pending = queues.filter((queue): queue is EditorSaveQueue =>
      Boolean(queue?.pending),
    );
    const operationWaiter = recordingEditorOperations.get(recordingId)?.idle;
    const waits = pending.map((queue) => queue.tail);
    if (operationWaiter) waits.push(operationWaiter);
    if (waits.length === 0) return;
    await Promise.all(waits);
  }
}

export async function refreshAfterRecordingEditorSaves(
  recordingId: string,
  refresh: () => Promise<unknown>,
): Promise<void> {
  await waitForRecordingEditorSaves(recordingId);
  await refresh();
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
