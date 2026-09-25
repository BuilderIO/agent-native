import { sourceContentHash } from "@shared/source-workspace";
import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import {
  flushFileContentSavesOnBackground,
  type FileContentSaveRequest,
} from "@/pages/design-editor/editor-state";

import {
  runQueueFileContentSave,
  runSaveFileContent,
  type QueueFileContentSaveArgs,
  type SaveFileContentArgs,
} from "./save-file-content";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup() {
  const journals: ReturnType<typeof deferred<boolean>>[] = [];
  const entry: DesignSaveOutboxEntry = {
    key: "design-1:screen-1:update-file",
    designId: "design-1",
    actorScope: "user-1",
    actionName: "update-file",
    resourceId: "screen-1",
    operationSource: "tab-a",
    operationRevision: 1,
    payload: {},
    updatedAt: 1,
  };
  const pendingFileSavesRef: QueueFileContentSaveArgs["pendingFileSavesRef"] = {
    current: {},
  };
  const latestFileSaveForUnloadRef: QueueFileContentSaveArgs["latestFileSaveForUnloadRef"] =
    {
      current: {},
    };
  const fileSaveTimersRef: QueueFileContentSaveArgs["fileSaveTimersRef"] = {
    current: {},
  };
  const fileSaveOutboxJournalPromisesRef: QueueFileContentSaveArgs["fileSaveOutboxJournalPromisesRef"] =
    {
      current: new WeakMap(),
    };
  const timerCallbacks = new Map<number, () => void>();
  let nextTimerId = 0;
  const journalOutboxEntry = vi.fn(() => {
    const journal = deferred<boolean>();
    journals.push(journal);
    return journal.promise;
  });
  const saved: Array<{
    pending: FileContentSaveRequest;
    journalPromise?: Promise<boolean>;
    completion: ReturnType<typeof runSaveFileContent>;
  }> = [];
  const saveArgs: SaveFileContentArgs = {
    acknowledgeOutboxEntry: vi.fn(async () => {}),
    canEditDesignRef: { current: true },
    createFileSaveOutboxEntry: vi.fn((pending) => ({
      ...entry,
      operationSource: pending.operationSource,
      operationRevision: pending.operationRevision,
      resourceId: pending.id,
      payload: { id: pending.id, content: pending.content },
    })),
    fileSaveChainsRef: { current: {} },
    fileSaveOutboxJournalPromisesRef,
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    rollbackPendingLocalFileContent: vi.fn(),
    markPendingLocalFileContent: vi.fn(),
    queryClient: new QueryClient(),
    setPatchProof: vi.fn(),
    t: (key) => key,
    updateFileMutation: {
      mutateAsync: vi.fn(async (input: { content: string }) => ({
        updated: true,
        versionHash: sourceContentHash(input.content),
      })),
    } as unknown as SaveFileContentArgs["updateFileMutation"],
    warnChangesWillRetry: vi.fn(),
  };
  const args: QueueFileContentSaveArgs = {
    canEditDesignRef: { current: true },
    createFileSaveOutboxEntry: vi.fn((pending) => ({
      ...entry,
      operationSource: pending.operationSource,
      operationRevision: pending.operationRevision,
      resourceId: pending.id,
      payload: { id: pending.id, content: pending.content },
    })),
    fileSaveOperationRevisionRef: { current: {} },
    fileSaveOutboxJournalPromisesRef,
    fileSaveTimersRef,
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    markPendingLocalFileContent: vi.fn(),
    operationSource: "tab-a",
    pendingFileSavesRef,
    saveFileContent: (pending, journalPromise) => {
      const completion = runSaveFileContent(saveArgs, pending, journalPromise);
      saved.push({ pending, journalPromise, completion });
      return completion;
    },
    setTimer: (callback) => {
      const timerId = ++nextTimerId;
      timerCallbacks.set(timerId, callback);
      return timerId;
    },
    clearTimer: (timerId) => {
      timerCallbacks.delete(timerId);
    },
  };
  return {
    args,
    entry,
    fileSaveOutboxJournalPromisesRef,
    journals,
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    pendingFileSavesRef,
    saveArgs,
    saved,
    timerCallbacks,
    fileSaveTimersRef,
  };
}

const options = { expectedVersionHash: "base" };

it("immediate saves receive and wait for their queued journal promise", async () => {
  const state = setup();
  const completion = runQueueFileContentSave(
    state.args,
    "screen-1",
    "<main>saved</main>",
    { ...options, immediate: true },
  );

  expect(state.saved).toHaveLength(1);
  const queued = state.saved[0]!;
  const journalPromise = state.fileSaveOutboxJournalPromisesRef.current.get(
    queued.pending,
  );
  expect(queued.journalPromise).toBe(journalPromise);
  expect(state.saveArgs.updateFileMutation.mutateAsync).not.toHaveBeenCalled();

  state.journals[0]!.resolve(true);
  await expect(completion).resolves.toBe("persisted");
});

it("debounced saves use the newest request's matching journal promise", async () => {
  const state = setup();
  runQueueFileContentSave(state.args, "screen-1", "first", options);
  runQueueFileContentSave(state.args, "screen-1", "second", options);

  expect(state.journalOutboxEntry).toHaveBeenCalledTimes(2);
  const [timerId, callback] = [...state.timerCallbacks.entries()][0]!;
  expect(timerId).toBe(state.fileSaveTimersRef.current["screen-1"]);
  callback();

  expect(state.saved).toHaveLength(1);
  const queued = state.saved[0]!;
  expect(queued.pending.content).toBe("second");
  expect(queued.pending.operationRevision).toBe(2);
  expect(queued.journalPromise).toBe(
    state.fileSaveOutboxJournalPromisesRef.current.get(queued.pending),
  );
  expect(queued.journalPromise).toBe(state.journals[1]!.promise);
  state.journals[0]!.resolve(true);
  await Promise.resolve();
  expect(state.saveArgs.updateFileMutation.mutateAsync).not.toHaveBeenCalled();
  state.journals[1]!.resolve(true);
  await expect(queued.completion).resolves.toBe("persisted");
});

it("background flush reuses the queued journal instead of starting another", async () => {
  const state = setup();
  runQueueFileContentSave(
    state.args,
    "screen-1",
    "<main>saved</main>",
    options,
  );
  const pending = state.pendingFileSavesRef.current["screen-1"]!;
  let completion: ReturnType<typeof runSaveFileContent> | undefined;

  const flush = flushFileContentSavesOnBackground(
    state.pendingFileSavesRef.current,
    state.latestFileSaveForUnloadRef.current,
    Object.values(state.fileSaveTimersRef.current),
    (queued) => {
      completion = runSaveFileContent(state.saveArgs, queued);
      return completion;
    },
    state.args.clearTimer,
  );

  expect(state.journalOutboxEntry).toHaveBeenCalledOnce();
  expect(state.saveArgs.updateFileMutation.mutateAsync).not.toHaveBeenCalled();
  expect(
    state.fileSaveOutboxJournalPromisesRef.current.get(pending),
  ).toBeDefined();
  state.journals[0]!.resolve(true);
  await expect(flush).resolves.toBeUndefined();
  await expect(completion).resolves.toBe("persisted");
});
