import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import {
  coalescePendingFileContentSave,
  type FileContentSaveRequest,
} from "@/pages/design-editor/editor-state";

import {
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
  it("keeps each queued hash when an earlier save acknowledges a newer version", async () => {
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
          expectedVersionHash: originalSourceHash,
        }),
      ],
    ]);
    expect(
      createFileSaveOutboxEntry.mock.calls.map(
        ([request]) => request.expectedVersionHash,
      ),
    ).toEqual([
      originalSourceHash,
      originalSourceHash,
      originalSourceHash,
      originalSourceHash,
    ]);
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
});
