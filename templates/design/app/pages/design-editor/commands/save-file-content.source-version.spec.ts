import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDesignSaveOutboxEntry,
  drainDesignSaveOutbox,
  type DesignSaveOutboxEntry,
  type DesignSaveOutboxStorage,
} from "@/lib/design-save-outbox";
import {
  coalescePendingFileContentSave,
  type FileContentSaveRequest,
} from "@/pages/design-editor/editor-state";

import {
  __clearVersionHistoryWarningsForTests,
  runFileContentSaveKeepalive,
  runSaveFileContent,
  type SaveFileContentArgs,
} from "./save-file-content";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("runSaveFileContent source version", () => {
  beforeEach(() => {
    __clearVersionHistoryWarningsForTests();
  });

  it("waits for the queued outbox entry and keeps it replayable after a failed save", async () => {
    const pending: FileContentSaveRequest = {
      id: "screen-outbox-stall",
      content: "<main>saved</main>",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: sourceContentHash("<main>original</main>"),
    };
    const entries = new Map<string, DesignSaveOutboxEntry>();
    const storage: DesignSaveOutboxStorage = {
      putLatest: async (entry) => {
        entries.set(entry.key, structuredClone(entry));
      },
      deleteIfRevision: async (entry) => {
        const current = entries.get(entry.key);
        if (
          current?.operationSource !== entry.operationSource ||
          current.operationRevision !== entry.operationRevision
        ) {
          return false;
        }
        entries.delete(entry.key);
        return true;
      },
      list: async (designId, actorScope) =>
        [...entries.values()].filter(
          (entry) =>
            entry.designId === designId && entry.actorScope === actorScope,
        ),
      pruneOlderThan: async () => 0,
    };
    const entry = createDesignSaveOutboxEntry({
      designId: "design-1",
      actorScope: "user-1",
      actionName: "update-file",
      resourceId: pending.id,
      operationSource: pending.operationSource,
      operationRevision: pending.operationRevision,
      payload: {
        id: pending.id,
        content: pending.content,
        syncCollab: pending.syncCollab,
        operationSource: pending.operationSource,
        operationRevision: pending.operationRevision,
        expectedVersionHash: pending.expectedVersionHash,
      },
    });
    const journal = deferred<void>();
    const journalOutboxEntry = vi.fn(
      async (queuedEntry: DesignSaveOutboxEntry) => {
        await journal.promise;
        await storage.putLatest(queuedEntry);
        return true;
      },
    );
    const outboxJournalPromise = journalOutboxEntry(entry);
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: {},
    };
    const mutateAsync = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const acknowledgeOutboxEntry = vi.fn(
      async (acknowledgedEntry: DesignSaveOutboxEntry) => {
        await storage.deleteIfRevision(acknowledgedEntry);
      },
    );
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry,
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(() => entry),
      fileSaveChainsRef,
      journalOutboxEntry,
      latestFileSaveForUnloadRef: { current: {} },
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent: vi.fn(),
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync,
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    const save = runSaveFileContent(args, pending, outboxJournalPromise);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mutateAsync).not.toHaveBeenCalled();
    journal.resolve();

    await expect(save).resolves.toBe("retryable");
    expect(journalOutboxEntry).toHaveBeenCalledOnce();
    expect(mutateAsync).toHaveBeenCalledOnce();
    expect(acknowledgeOutboxEntry).not.toHaveBeenCalled();
    expect(entries.get(entry.key)).toEqual(entry);

    const replay = await drainDesignSaveOutbox({
      designId: "design-1",
      actorScope: "user-1",
      storage,
      invokeAction: async () => ({
        updated: true,
        versionHash: sourceContentHash(pending.content),
      }),
    });

    expect(replay.failed).toEqual([]);
    expect(replay.saved).toEqual([entry]);
    expect(entries.size).toBe(0);
  });

  it("does not claim an offline save will retry when journaling failed", async () => {
    const pending: FileContentSaveRequest = {
      id: "screen-unavailable-outbox",
      content: "<main>saved</main>",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: "base",
    };
    const warnChangesWillRetry = vi.fn();
    const errorToast = vi
      .spyOn(toast, "error")
      .mockImplementation(() => "test-toast");
    vi.stubGlobal("navigator", { onLine: false });
    const mutateAsync = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(() => null),
      fileSaveChainsRef: { current: {} },
      journalOutboxEntry: vi.fn(async () => false),
      latestFileSaveForUnloadRef: { current: {} },
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent: vi.fn(),
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync,
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry,
    };

    try {
      await expect(runSaveFileContent(args, pending)).resolves.toBe("failed");
      expect(mutateAsync).toHaveBeenCalledOnce();
      expect(warnChangesWillRetry).not.toHaveBeenCalled();
      expect(errorToast).toHaveBeenCalledWith("common.genericError", {
        id: `design-save-error:${pending.id}`,
      });
    } finally {
      vi.unstubAllGlobals();
      errorToast.mockRestore();
    }
  });

  it("reuses the queued outbox promise for pagehide keepalive saves", () => {
    const pending: FileContentSaveRequest = {
      id: "screen-queued-keepalive",
      content: "<main>saved</main>",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: "base",
    };
    const journalOutboxEntry = vi.fn(async () => true);
    const sendKeepalive = vi.fn(() => ({
      accepted: true as const,
      completion: Promise.reject(new TypeError("Failed to fetch")),
    }));

    runFileContentSaveKeepalive(
      {
        acknowledgeOutboxEntry: vi.fn(async () => {}),
        createFileSaveOutboxEntry: vi.fn(() => ({}) as never),
        journalOutboxEntry,
        latestFileSaveForUnloadRef: { current: { [pending.id]: pending } },
        outboxJournalPromise: Promise.resolve(true),
        sendKeepalive,
      },
      pending,
    );

    expect(journalOutboxEntry).not.toHaveBeenCalled();
    expect(sendKeepalive).toHaveBeenCalledOnce();
  });

  it("replays from the oldest base when a successor keepalive races a missing predecessor", async () => {
    const baseContent = "<main>original</main>";
    const predecessorContent = "<main>predecessor</main>";
    const successorContent = "<main>successor</main>";
    const baseHash = sourceContentHash(baseContent);
    const pending: FileContentSaveRequest = {
      id: "screen-keepalive-race",
      content: successorContent,
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 2,
      expectedVersionHash: sourceContentHash(predecessorContent),
      unloadExpectedVersionHash: baseHash,
    };
    const entries = new Map<string, DesignSaveOutboxEntry>();
    const storage: DesignSaveOutboxStorage = {
      putLatest: async (entry) => {
        entries.set(entry.key, structuredClone(entry));
      },
      deleteIfRevision: async (entry) => {
        const current = entries.get(entry.key);
        if (
          current?.operationSource !== entry.operationSource ||
          current.operationRevision !== entry.operationRevision
        ) {
          return false;
        }
        entries.delete(entry.key);
        return true;
      },
      list: async () => [...entries.values()],
      pruneOlderThan: async () => 0,
    };
    const journalOutboxEntry = vi.fn(async (entry: DesignSaveOutboxEntry) => {
      await storage.putLatest(entry);
      return true;
    });
    const createFileSaveOutboxEntry = vi.fn((request: FileContentSaveRequest) =>
      createDesignSaveOutboxEntry({
        designId: "design-1",
        actorScope: "user-1",
        actionName: "update-file",
        resourceId: request.id,
        operationSource: request.operationSource,
        operationRevision: request.operationRevision,
        payload: {
          id: request.id,
          content: request.content,
          syncCollab: request.syncCollab,
          operationSource: request.operationSource,
          operationRevision: request.operationRevision,
          expectedVersionHash:
            request.unloadExpectedVersionHash ?? request.expectedVersionHash,
        },
      }),
    );
    const acknowledgeOutboxEntry = vi.fn(
      async (entry: DesignSaveOutboxEntry) => {
        await storage.deleteIfRevision(entry);
      },
    );
    const directConflict = Object.assign(
      new Error("predecessor did not commit"),
      { status: 409 },
    );
    const sendKeepalive = vi.fn((payload: Record<string, unknown>) => ({
      accepted: true as const,
      completion: Promise.reject(directConflict),
      payload,
    }));

    runFileContentSaveKeepalive(
      {
        acknowledgeOutboxEntry,
        createFileSaveOutboxEntry,
        journalOutboxEntry,
        latestFileSaveForUnloadRef: { current: { [pending.id]: pending } },
        sendKeepalive,
      },
      pending,
    );

    expect(journalOutboxEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ expectedVersionHash: baseHash }),
      }),
    );
    expect(
      createFileSaveOutboxEntry.mock.calls.map(
        ([request]) => request.unloadExpectedVersionHash,
      ),
    ).toEqual([baseHash, undefined]);
    expect(sendKeepalive).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersionHash: sourceContentHash(predecessorContent),
      }),
    );

    const invokeAction = vi.fn(async (_actionName, payload) => {
      expect(payload.expectedVersionHash).toBe(baseHash);
      return {
        updated: true,
        versionHash: sourceContentHash(successorContent),
      };
    });
    const result = await drainDesignSaveOutbox({
      designId: "design-1",
      actorScope: "user-1",
      invokeAction,
      storage,
    });

    expect(result.failed).toEqual([]);
    expect(result.saved).toHaveLength(1);
    expect(acknowledgeOutboxEntry).not.toHaveBeenCalled();
    expect(entries.size).toBe(0);
  });

  it("keeps each dependent queued hash while an earlier save is in flight", async () => {
    const originalSourceHash = "hash-of-original-source";
    const firstPending: FileContentSaveRequest = {
      id: "screen-a",
      content: "<main>first edit</main>",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: originalSourceHash,
    };
    const secondPending: FileContentSaveRequest = {
      ...firstPending,
      content: "<main>second edit</main>",
      operationRevision: 2,
      expectedVersionHash: sourceContentHash(firstPending.content),
    };
    let releaseFirstSave!: (value: unknown) => void;
    let markFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      markFirstSaveStarted = resolve;
    });
    const firstSaveResponse = new Promise<unknown>((resolve) => {
      releaseFirstSave = resolve;
    });
    const mutateAsync = vi.fn((input: { operationRevision: number }) => {
      if (input.operationRevision === 1) {
        markFirstSaveStarted();
        return firstSaveResponse;
      }
      return Promise.resolve({
        updated: true,
        versionHash: sourceContentHash(secondPending.content),
      });
    });
    const updateFileMutation = {
      mutateAsync,
    } as unknown as SaveFileContentArgs["updateFileMutation"];
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: {},
    };
    const createFileSaveOutboxEntry = vi.fn(
      (pending: FileContentSaveRequest) =>
        ({
          key: `design-a:user-a:update-file:screen-a:${pending.operationRevision}`,
        }) as DesignSaveOutboxEntry,
    );
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry,
      fileSaveChainsRef,
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef: { current: {} },
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent: vi.fn(),
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation,
      warnChangesWillRetry: vi.fn(),
    };

    runSaveFileContent(args, firstPending);
    runSaveFileContent(args, secondPending);
    await firstSaveStarted;
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    releaseFirstSave({
      updated: true,
      versionHash: sourceContentHash(firstPending.content),
    });
    await fileSaveChainsRef.current[firstPending.id];

    expect(mutateAsync.mock.calls).toEqual([
      [
        expect.objectContaining({
          id: firstPending.id,
          content: firstPending.content,
          expectedVersionHash: originalSourceHash,
        }),
      ],
      [
        expect.objectContaining({
          id: secondPending.id,
          content: secondPending.content,
          expectedVersionHash: sourceContentHash(firstPending.content),
        }),
      ],
    ]);
    expect(
      createFileSaveOutboxEntry.mock.calls.map(([request]) => ({
        operationRevision: request.operationRevision,
        expectedVersionHash: request.expectedVersionHash,
      })),
    ).toEqual([
      { operationRevision: 1, expectedVersionHash: originalSourceHash },
      {
        operationRevision: 2,
        expectedVersionHash: sourceContentHash(firstPending.content),
      },
      { operationRevision: 1, expectedVersionHash: originalSourceHash },
      {
        operationRevision: 2,
        expectedVersionHash: sourceContentHash(firstPending.content),
      },
    ]);
  });

  it("advances the durable unload base after a predecessor is acknowledged", async () => {
    const baseHash = "hash-of-original-source";
    const firstPending: FileContentSaveRequest = {
      id: "screen-a",
      content: "<main>first edit</main>",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: baseHash,
      unloadExpectedVersionHash: baseHash,
    };
    const secondPending: FileContentSaveRequest = {
      ...firstPending,
      content: "<main>second edit</main>",
      operationRevision: 2,
      expectedVersionHash: sourceContentHash(firstPending.content),
    };
    const firstSave = deferred<unknown>();
    const advancedJournalStarted = deferred<void>();
    const advancedJournal = deferred<boolean>();
    const mutateAsync = vi.fn((input: { operationRevision: number }) =>
      input.operationRevision === 1
        ? firstSave.promise
        : Promise.resolve({
            updated: true,
            versionHash: sourceContentHash(secondPending.content),
          }),
    );
    const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
      {
        current: {},
      };
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: {},
    };
    const createFileSaveOutboxEntry = vi.fn(
      (request: FileContentSaveRequest) =>
        ({ key: `save:${request.operationRevision}` }) as DesignSaveOutboxEntry,
    );
    const journalOutboxEntry = vi.fn(async (entry: DesignSaveOutboxEntry) => {
      if (
        entry.key === "save:2" &&
        secondPending.unloadExpectedVersionHash ===
          sourceContentHash(firstPending.content)
      ) {
        advancedJournalStarted.resolve();
        return advancedJournal.promise;
      }
      return true;
    });
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry,
      fileSaveChainsRef,
      journalOutboxEntry,
      latestFileSaveForUnloadRef,
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent: vi.fn(),
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync,
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    runSaveFileContent(args, firstPending);
    runSaveFileContent(args, secondPending);
    firstSave.resolve({
      updated: true,
      versionHash: sourceContentHash(firstPending.content),
    });
    await advancedJournalStarted.promise;
    let chainSettled = false;
    const chain = fileSaveChainsRef.current[firstPending.id]!;
    void chain.then(() => {
      chainSettled = true;
    });
    await Promise.resolve();
    expect(chainSettled).toBe(false);
    advancedJournal.resolve(true);
    await chain;

    expect(secondPending.unloadExpectedVersionHash).toBe(
      sourceContentHash(firstPending.content),
    );
    expect(
      createFileSaveOutboxEntry.mock.calls.some(
        ([request]) =>
          request === secondPending &&
          request.unloadExpectedVersionHash ===
            sourceContentHash(firstPending.content),
      ),
    ).toBe(true);
  });

  it("retires the identity migration marker after its canonical save lands", async () => {
    const id = "screen-identity-marker";
    const raw = "<main><button>Before</button></main>";
    const canonical =
      '<main><button data-agent-native-node-id="button-a">Before</button></main>';
    const pending: FileContentSaveRequest = {
      id,
      content: canonical,
      identityMigrationSourceContent: raw,
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: sourceContentHash(raw),
    };
    const markPendingLocalFileContent = vi.fn();
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: {},
    };
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(() => null),
      fileSaveChainsRef,
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef: { current: {} },
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent,
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync: vi.fn(async () => ({
          updated: true,
          versionHash: sourceContentHash(canonical),
        })),
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    runSaveFileContent(args, pending);
    await fileSaveChainsRef.current[id];

    expect(markPendingLocalFileContent).toHaveBeenLastCalledWith(id, canonical);
  });

  it("persists an in-flight identity migration before its dependent user edit", async () => {
    const id = "screen-identity-chain";
    const raw = "<main><button>Before</button></main>";
    const canonical =
      '<main><button data-agent-native-node-id="button-a">Before</button></main>';
    const userContent = canonical.replace("Before", "After");
    const migration: FileContentSaveRequest = {
      id,
      content: canonical,
      identityMigrationSourceContent: raw,
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: sourceContentHash(raw),
    };
    const userSave: FileContentSaveRequest = {
      id,
      content: userContent,
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 2,
      expectedVersionHash: sourceContentHash(canonical),
    };
    const migrationResponse = deferred<unknown>();
    const migrationStarted = deferred<void>();
    const mutateAsync = vi.fn((input: { operationRevision: number }) => {
      if (input.operationRevision === migration.operationRevision) {
        migrationStarted.resolve();
        return migrationResponse.promise;
      }
      return Promise.resolve({
        updated: true,
        versionHash: sourceContentHash(userContent),
      });
    });
    const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
      { current: {} };
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: {},
    };
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(() => null),
      fileSaveChainsRef,
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef,
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent: vi.fn(),
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync,
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    runSaveFileContent(args, migration);
    await migrationStarted.promise;
    runSaveFileContent(args, userSave);
    migrationResponse.resolve({
      updated: true,
      versionHash: sourceContentHash(canonical),
    });
    await fileSaveChainsRef.current[id];

    expect(mutateAsync.mock.calls).toEqual([
      [
        expect.objectContaining({
          content: canonical,
          expectedVersionHash: sourceContentHash(raw),
          identityOnly: true,
        }),
      ],
      [
        expect.objectContaining({
          content: userContent,
          expectedVersionHash: sourceContentHash(canonical),
        }),
      ],
    ]);
  });

  it("treats a stale-mirror 200 response as a save conflict", async () => {
    const pending: FileContentSaveRequest = {
      id: "screen-stale-mirror",
      content: "<main>stale local snapshot</main>",
      syncCollab: false,
      operationSource: "tab-a",
      operationRevision: 2,
      expectedVersionHash: "stale-base-hash",
    };
    const rollbackPendingLocalFileContent = vi.fn();
    const invalidateQueries = vi.fn();
    const acknowledgeOutboxEntry = vi.fn(async () => {});
    const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
      {
        current: {},
      };
    const conflictToast = vi
      .spyOn(toast, "error")
      .mockImplementation(() => "test-toast");
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: {},
    };
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry,
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(
        () => ({ key: "stale-mirror" }) as DesignSaveOutboxEntry,
      ),
      fileSaveChainsRef,
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef,
      rollbackPendingLocalFileContent,
      markPendingLocalFileContent: vi.fn(),
      queryClient: { invalidateQueries } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync: vi.fn(async () => ({
          updated: true,
          skippedStaleMirror: true,
        })),
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    try {
      runSaveFileContent(args, pending);
      await fileSaveChainsRef.current[pending.id];

      expect(rollbackPendingLocalFileContent).toHaveBeenCalledWith(
        pending.id,
        pending.content,
      );
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["action", "get-design"],
      });
      expect(acknowledgeOutboxEntry).not.toHaveBeenCalled();
      expect(latestFileSaveForUnloadRef.current[pending.id]).toBeUndefined();
      expect(conflictToast).toHaveBeenCalledWith(
        "designEditor.toasts.saveConflict",
        expect.objectContaining({
          id: `design-save-conflict:${pending.id}`,
        }),
      );
    } finally {
      conflictToast.mockRestore();
    }
  });

  it("clears a rejected latest save snapshot when it is still current", async () => {
    const pending: FileContentSaveRequest = {
      id: "screen-rejected-save",
      content: "<main>rejected local snapshot</main>",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: "stale-base-hash",
    };
    const rollbackPendingLocalFileContent = vi.fn();
    const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
      {
        current: { [pending.id]: pending },
      };
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: {},
    };
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(() => null),
      fileSaveChainsRef,
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef,
      rollbackPendingLocalFileContent,
      markPendingLocalFileContent: vi.fn(),
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync: vi.fn(async () => {
          const error = new Error("source file changed; re-read the file");
          Object.assign(error, { status: 409 });
          throw error;
        }),
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    runSaveFileContent(args, pending);
    await fileSaveChainsRef.current[pending.id];

    expect(rollbackPendingLocalFileContent).toHaveBeenCalledWith(
      pending.id,
      pending.content,
    );
    expect(latestFileSaveForUnloadRef.current[pending.id]).toBeUndefined();
  });

  it("drops a queued identity migration when a newer user save takes priority", async () => {
    const id = "screen-migration";
    const raw = '<main><button id="duplicate">Before</button></main>';
    const canonical =
      '<main><button id="duplicate" data-agent-native-node-id="node-a">Before</button></main>';
    const userContent = canonical.replace("Before", "After user edit");
    const migration: FileContentSaveRequest = {
      id,
      content: canonical,
      identityMigrationSourceContent: raw,
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: "raw-source-cas",
    };
    const migrationOutbox = { key: "migration:1" } as DesignSaveOutboxEntry;
    const userOutbox = { key: "user:2" } as DesignSaveOutboxEntry;
    let releasePrevious!: () => void;
    const previousSave = new Promise<void>((resolve) => {
      releasePrevious = resolve;
    });
    const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
      {
        current: {},
      };
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: { [id]: previousSave },
    };
    const pendingLocal = new Map<
      string,
      { content: string; identityMigrationSourceContent?: string }
    >();
    const mutateAsync = vi.fn(async () => ({
      updated: true,
      versionHash: sourceContentHash(userContent),
    }));
    const createFileSaveOutboxEntry = vi.fn((request: FileContentSaveRequest) =>
      request.identityMigrationSourceContent !== undefined
        ? migrationOutbox
        : userOutbox,
    );
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry,
      fileSaveChainsRef,
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef,
      rollbackPendingLocalFileContent: vi.fn(
        (fileId: string, expectedContent?: string) => {
          const current = pendingLocal.get(fileId);
          if (
            !current ||
            (expectedContent && current.content !== expectedContent)
          )
            return;
          pendingLocal.delete(fileId);
        },
      ),
      markPendingLocalFileContent: vi.fn(
        (
          fileId: string,
          content: string,
          _baseUpdatedAt?: string | null,
          identityMigrationSourceContent?: string,
        ) => {
          pendingLocal.set(fileId, { content, identityMigrationSourceContent });
        },
      ),
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync,
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    runSaveFileContent(args, migration);
    const migrationChain = fileSaveChainsRef.current[id]!;
    const newerUserSave = coalescePendingFileContentSave(
      {
        id,
        content: userContent,
        syncCollab: true,
        operationSource: "tab-a",
        operationRevision: 2,
        expectedVersionHash: "canonical-source-cas",
      },
      migration,
    );
    runSaveFileContent(args, newerUserSave);
    const latestChain = fileSaveChainsRef.current[id]!;

    expect(latestFileSaveForUnloadRef.current[id]).toBe(newerUserSave);
    expect(pendingLocal.get(id)).toEqual({
      content: userContent,
      identityMigrationSourceContent: undefined,
    });
    releasePrevious();
    await latestChain;

    expect(mutateAsync.mock.calls).toEqual([
      [
        expect.objectContaining({
          id,
          content: userContent,
          expectedVersionHash: "raw-source-cas",
        }),
      ],
    ]);
    expect(args.acknowledgeOutboxEntry).toHaveBeenCalledWith(migrationOutbox);
    expect(args.acknowledgeOutboxEntry).toHaveBeenCalledWith(userOutbox);
    expect(pendingLocal.get(id)?.content).toBe(userContent);
    expect(fileSaveChainsRef.current[id]).not.toBe(migrationChain);
  });

  it("does not send a cancelled identity migration after its latest slot is removed", async () => {
    const id = "screen-cancelled-migration";
    const migration: FileContentSaveRequest = {
      id,
      content: '<main data-agent-native-node-id="node-a">Canonical</main>',
      identityMigrationSourceContent: "<main>Canonical</main>",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: "raw-source-cas",
    };
    let releasePrevious!: () => void;
    const previousSave = new Promise<void>((resolve) => {
      releasePrevious = resolve;
    });
    const migrationOutbox = {
      key: "cancelled-migration:1",
    } as DesignSaveOutboxEntry;
    const mutateAsync = vi.fn(async () => ({}));
    const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
      {
        current: {},
      };
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: { [id]: previousSave },
    };
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(() => migrationOutbox),
      fileSaveChainsRef,
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef,
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent: vi.fn(),
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync,
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    runSaveFileContent(args, migration);
    const chain = fileSaveChainsRef.current[id]!;
    delete latestFileSaveForUnloadRef.current[id];
    releasePrevious();
    await chain;

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(args.acknowledgeOutboxEntry).toHaveBeenCalledWith(migrationOutbox);
  });

  it.each(["success", "error"] as const)(
    "ignores a superseded in-flight identity migration after late %s",
    async (outcome) => {
      const id = `screen-late-${outcome}`;
      const rawA = "<main><p>remote A</p></main>";
      const rawB = "<main><p>newer remote B</p></main>";
      const oldMigration: FileContentSaveRequest = {
        id,
        content:
          '<main><p data-agent-native-node-id="node-a">remote A</p></main>',
        identityMigrationSourceContent: rawA,
        syncCollab: true,
        operationSource: "tab-a",
        operationRevision: 1,
        expectedVersionHash: "raw-a-cas",
      };
      const nextMigration: FileContentSaveRequest =
        coalescePendingFileContentSave(
          {
            ...oldMigration,
            content:
              '<main><p data-agent-native-node-id="node-b">newer remote B</p></main>',
            identityMigrationSourceContent: rawB,
            operationRevision: 2,
            expectedVersionHash: "raw-b-cas",
          },
          oldMigration,
        );
      const oldOutbox = { key: `${id}:old-migration` } as DesignSaveOutboxEntry;
      const newOutbox = { key: `${id}:new-migration` } as DesignSaveOutboxEntry;
      const oldResponse = deferred<unknown>();
      const newResponse = deferred<unknown>();
      const oldStarted = deferred<void>();
      const newStarted = deferred<void>();
      const pendingLocal = new Map<
        string,
        { content: string; identityMigrationSourceContent?: string }
      >();
      const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
        {
          current: {},
        };
      const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
        current: {},
      };
      const mutateAsync = vi.fn((input: { content: string }) => {
        if (input.content === oldMigration.content) {
          oldStarted.resolve();
          return oldResponse.promise;
        }
        newStarted.resolve();
        return newResponse.promise;
      });
      const invalidateQueries = vi.fn();
      const setPatchProof = vi.fn();
      const rollbackPendingLocalFileContent = vi.fn(
        (fileId: string, expectedContent?: string) => {
          const current = pendingLocal.get(fileId);
          if (
            !current ||
            (expectedContent && current.content !== expectedContent)
          ) {
            return;
          }
          pendingLocal.delete(fileId);
        },
      );
      const args: SaveFileContentArgs = {
        acknowledgeOutboxEntry: vi.fn(async () => {}),
        canEditDesignRef: { current: true },
        createFileSaveOutboxEntry: vi.fn((request: FileContentSaveRequest) =>
          request.identityMigrationSourceContent === rawA
            ? oldOutbox
            : newOutbox,
        ),
        fileSaveChainsRef,
        journalOutboxEntry: vi.fn(async () => true),
        latestFileSaveForUnloadRef,
        rollbackPendingLocalFileContent,
        markPendingLocalFileContent: vi.fn(
          (
            fileId: string,
            content: string,
            _baseUpdatedAt?: string | null,
            identityMigrationSourceContent?: string,
          ) =>
            pendingLocal.set(fileId, {
              content,
              identityMigrationSourceContent,
            }),
        ),
        queryClient: { invalidateQueries } as unknown as QueryClient,
        setPatchProof,
        t: (key) => key,
        updateFileMutation: {
          mutateAsync,
        } as unknown as SaveFileContentArgs["updateFileMutation"],
        warnChangesWillRetry: vi.fn(),
      };
      const errorToast = vi
        .spyOn(toast, "error")
        .mockImplementation(() => "test-toast");

      try {
        runSaveFileContent(args, oldMigration);
        const oldChain = fileSaveChainsRef.current[id]!;
        await oldStarted.promise;
        expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({
          content: oldMigration.content,
          identityOnly: true,
        });

        runSaveFileContent(args, nextMigration);
        const latestChain = fileSaveChainsRef.current[id]!;
        expect(latestFileSaveForUnloadRef.current[id]).toBe(nextMigration);
        expect(pendingLocal.get(id)).toEqual({
          content: nextMigration.content,
          identityMigrationSourceContent: rawB,
        });

        if (outcome === "success") {
          oldResponse.resolve({});
        } else {
          oldResponse.reject(new Error("old migration request failed"));
        }
        await newStarted.promise;
        await oldChain;

        expect(mutateAsync.mock.calls).toHaveLength(2);
        expect(mutateAsync.mock.calls[1]?.[0]).toMatchObject({
          content: nextMigration.content,
          expectedVersionHash: "raw-b-cas",
          identityOnly: true,
        });
        expect(pendingLocal.get(id)).toEqual({
          content: nextMigration.content,
          identityMigrationSourceContent: rawB,
        });
        expect(latestFileSaveForUnloadRef.current[id]).toBe(nextMigration);
        expect(rollbackPendingLocalFileContent).not.toHaveBeenCalled();
        expect(setPatchProof).not.toHaveBeenCalled();
        expect(invalidateQueries).not.toHaveBeenCalled();
        expect(args.warnChangesWillRetry).not.toHaveBeenCalled();
        expect(errorToast).not.toHaveBeenCalled();
        expect(args.acknowledgeOutboxEntry).toHaveBeenCalledWith(oldOutbox);

        newResponse.resolve({
          updated: true,
          versionHash: sourceContentHash(nextMigration.content),
        });
        await latestChain;
      } finally {
        errorToast.mockRestore();
      }
    },
  );

  it("patches get-design directly with the saved content", async () => {
    const designId = "design-42";
    const pending: FileContentSaveRequest = {
      id: "screen-a",
      content: "<main>saved content</main>",
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision: 1,
      expectedVersionHash: "hash-of-original-source",
    };
    const setQueryData = vi.fn();
    const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
      current: {},
    };
    const args: SaveFileContentArgs = {
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(() => null),
      designId,
      fileSaveChainsRef,
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef: { current: {} },
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent: vi.fn(),
      queryClient: {
        setQueryData,
        invalidateQueries: vi.fn(),
      } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync: vi.fn(async () => ({
          updated: true,
          versionHash: sourceContentHash(pending.content),
        })),
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    };

    runSaveFileContent(args, pending);
    await fileSaveChainsRef.current[pending.id];

    expect(setQueryData).toHaveBeenCalledWith(
      ["action", "get-design", { id: designId }],
      expect.any(Function),
    );
    const updater = setQueryData.mock.calls[0]![1] as (old: unknown) => unknown;
    expect(
      updater({ files: [{ id: pending.id, content: "<main>stale</main>" }] }),
    ).toEqual({ files: [{ id: pending.id, content: pending.content }] });
  });

  it("shows exactly one version-history-unavailable toast per design across repeated skipped-checkpoint saves", async () => {
    const designId = "design-43";
    const buildPending = (
      content: string,
      operationRevision: number,
    ): FileContentSaveRequest => ({
      id: "screen-a",
      content,
      syncCollab: true,
      operationSource: "tab-a",
      operationRevision,
      expectedVersionHash: "hash-of-original-source",
    });
    const warningToast = vi
      .spyOn(toast, "warning")
      .mockImplementation(() => "test-toast");
    const buildArgs = (): SaveFileContentArgs => ({
      acknowledgeOutboxEntry: vi.fn(async () => {}),
      canEditDesignRef: { current: true },
      createFileSaveOutboxEntry: vi.fn(() => null),
      designId,
      fileSaveChainsRef: { current: {} },
      journalOutboxEntry: vi.fn(async () => true),
      latestFileSaveForUnloadRef: { current: {} },
      rollbackPendingLocalFileContent: vi.fn(),
      markPendingLocalFileContent: vi.fn(),
      queryClient: {
        setQueryData: vi.fn(),
        invalidateQueries: vi.fn(),
      } as unknown as QueryClient,
      setPatchProof: vi.fn(),
      t: (key) => key,
      updateFileMutation: {
        mutateAsync: vi.fn(async (input: { content: string }) => ({
          updated: true,
          versionHash: sourceContentHash(input.content),
          checkpoint: { skipped: true, reason: "blob-storage-unavailable" },
        })),
      } as unknown as SaveFileContentArgs["updateFileMutation"],
      warnChangesWillRetry: vi.fn(),
    });

    try {
      const firstArgs = buildArgs();
      const firstPending = buildPending("<main>large design content</main>", 1);
      runSaveFileContent(firstArgs, firstPending);
      await firstArgs.fileSaveChainsRef.current[firstPending.id];

      // A second, later autosave for the same design must not repeat the
      // toast — sonner's `id` alone doesn't guarantee that once the first
      // toast has auto-dismissed (see warnedVersionHistoryDesigns).
      const secondArgs = buildArgs();
      const secondPending = buildPending(
        "<main>large design content, edited</main>",
        2,
      );
      runSaveFileContent(secondArgs, secondPending);
      await secondArgs.fileSaveChainsRef.current[secondPending.id];

      expect(warningToast).toHaveBeenCalledTimes(1);
      expect(warningToast).toHaveBeenCalledWith(
        "designEditor.toasts.versionHistoryUnavailable",
        expect.objectContaining({
          id: `design-version-history-unavailable:${designId}`,
        }),
      );
    } finally {
      warningToast.mockRestore();
    }
  });
});
