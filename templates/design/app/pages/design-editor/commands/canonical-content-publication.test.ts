import { applyTextToYDoc } from "@agent-native/core/collab";
import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";

import { runApplyFileContentUpdate } from "@/pages/design-editor/commands/apply-file-content-update";
import {
  runApplyLocalContentUpdate,
  type ApplyLocalContentUpdateArgs,
} from "@/pages/design-editor/commands/apply-local-content-update";

const oldContent = "<main><p>Old</p></main>";
const rawContent =
  '<main><button data-agent-native-node-id="shared">A</button><button data-agent-native-node-id="shared">B</button></main>';
const migrationSource = "<main><button>A</button></main>";
const activeFile = {
  id: "screen-a",
  filename: "screen-a.html",
  fileType: "html",
  content: oldContent,
  updatedAt: "2026-09-13T00:00:00.000Z",
  createdAt: "2026-09-12T00:00:00.000Z",
} as const;

function localArgs(overrides: Record<string, unknown> = {}) {
  return {
    acknowledgeAuthoritativeClipboardMutation: () => {},
    activeFile,
    canEditDesignRef: { current: true },
    cancelQueuedFileContentSave: () => {},
    clearPendingLocalFileContent: () => {},
    collabContentFileIdRef: { current: activeFile.id },
    collabContentRef: { current: oldContent },
    id: undefined,
    isSynced: false,
    lastLocalContentRef: { current: oldContent },
    latestActiveContentRef: { current: oldContent },
    markPendingLocalFileContent: () => {},
    queryClient: { setQueryData: () => {} },
    queueFileContentSave: () => {},
    recordContentHistoryEntry: () => {},
    recordLocalContentHistoryChangeFallback: () => {},
    recordLocalContentHistoryEntry: () => {},
    replacePreviewContent: () => "applied",
    setCollabContent: () => {},
    setCollabContentFileId: () => {},
    setContentRenderRevision: () => {},
    suppressContentHistoryRef: { current: false },
    t: () => "Save failed",
    undoManagerRef: { current: null },
    viewModeRef: { current: "single" },
    ydoc: null,
    ...overrides,
  } as unknown as ApplyLocalContentUpdateArgs;
}

it("returns the accepted local bytes/map and queues against the raw CAS preimage", () => {
  let queued:
    | {
        content: string;
        options: {
          expectedVersionHash: string;
          identityMigrationSourceContent?: string;
        };
      }
    | undefined;
  let pending: { content: string; migrationSource?: string } | undefined;
  const result = runApplyLocalContentUpdate(
    localArgs({
      queueFileContentSave: (
        _fileId: string,
        content: string,
        options: {
          expectedVersionHash: string;
          identityMigrationSourceContent?: string;
        },
      ) => (queued = { content, options }),
      markPendingLocalFileContent: (
        _fileId: string,
        content: string,
        _updatedAt: string | null | undefined,
        identityMigrationSourceContent?: string,
      ) =>
        (pending = {
          content,
          migrationSource: identityMigrationSourceContent,
        }),
    }),
    rawContent,
    {
      historyBeforeContent: oldContent,
      sourceBaseContent: rawContent,
      identityMigrationSourceContent: migrationSource,
    },
  );

  expect(result.status).toBe("accepted");
  if (result.status !== "accepted") return;
  expect(result.content).not.toBe(rawContent);
  expect(result.nodeIdMap.size).toBeGreaterThan(0);
  expect(queued?.content).toBe(result.content);
  expect(queued?.options.expectedVersionHash).toBe(
    sourceContentHash(rawContent),
  );
  expect(queued?.options.identityMigrationSourceContent).toBe(migrationSource);
  expect(pending).toEqual({ content: result.content, migrationSource });
});

it("publishes canonical bytes for a nonactive screen", () => {
  let queued:
    | { content: string; options: { expectedVersionHash: string } }
    | undefined;
  let pendingContent: string | undefined;
  const result = runApplyFileContentUpdate(
    {
      acknowledgeAuthoritativeClipboardMutation: () => {},
      activeFile: { ...activeFile, id: "screen-b" },
      applyFileContentUpdate: () => {},
      applyLocalContentUpdate: () => ({ status: "refused" }),
      canEditDesignRef: { current: true },
      cancelQueuedFileContentSave: () => {},
      clearPendingLocalFileContent: () => {},
      files: [activeFile],
      getScreenContent: () => oldContent,
      id: undefined,
      markPendingLocalFileContent: (_fileId, content) =>
        (pendingContent = content),
      overviewIsSynced: false,
      overviewPresenceFileId: null,
      overviewYdoc: null,
      queryClient: { setQueryData: () => {} } as unknown as QueryClient,
      queueFileContentSave: (_fileId, content, options) => {
        queued = { content, options };
      },
      recordContentHistoryEntry: () => {},
      suppressContentHistoryRef: { current: false },
      t: () => "Save failed",
    },
    activeFile.id,
    rawContent,
    { historyBeforeContent: oldContent, sourceBaseContent: rawContent },
  );

  expect(result.status).toBe("accepted");
  if (result.status !== "accepted") return;
  expect(result.content).toBe(queued?.content);
  expect(result.content).toBe(pendingContent);
  expect(result.content).not.toBe(rawContent);
  expect(result.nodeIdMap.size).toBeGreaterThan(0);
  expect(queued?.options.expectedVersionHash).toBe(
    sourceContentHash(rawContent),
  );
});

it("migrates server-acknowledged raw bytes but leaves an ordinary unsaved preview unsaved", () => {
  let migrationQueue:
    | {
        content: string;
        options: {
          expectedVersionHash: string;
          syncCollab?: boolean;
          immediate?: boolean;
          identityMigrationSourceContent?: string;
        };
      }
    | undefined;
  let pendingMigration:
    | { baseUpdatedAt?: string | null; sourceContent?: string }
    | undefined;
  let migrationCanceled = false;
  const ydoc = new Y.Doc();
  ydoc.getText("content").insert(0, rawContent);
  const migrationResult = runApplyLocalContentUpdate(
    localArgs({
      ydoc,
      isSynced: true,
      cancelQueuedFileContentSave: () => {
        migrationCanceled = true;
      },
      markPendingLocalFileContent: (
        _fileId: string,
        _content: string,
        baseUpdatedAt?: string | null,
        sourceContent?: string,
      ) => (pendingMigration = { baseUpdatedAt, sourceContent }),
      queueFileContentSave: (
        _fileId: string,
        content: string,
        options: NonNullable<typeof migrationQueue>["options"],
      ) => (migrationQueue = { content, options }),
    }),
    rawContent,
    { updatedAt: "server-accepted-at", persist: false },
  );
  expect(migrationResult.status).toBe("accepted");
  expect(migrationCanceled).toBe(false);
  expect(ydoc.getText("content").toString()).toBe(rawContent);
  ydoc.destroy();
  expect(migrationQueue?.content).toBe(
    migrationResult.status === "accepted" ? migrationResult.content : undefined,
  );
  expect(migrationQueue?.options).toEqual({
    expectedVersionHash: sourceContentHash(rawContent),
    syncCollab: true,
    immediate: true,
    identityMigrationSourceContent: rawContent,
  });
  expect(pendingMigration).toEqual({
    baseUpdatedAt: "server-accepted-at",
    sourceContent: rawContent,
  });

  let canceledOrdinarySave = false;
  let ordinaryQueueCalled = false;
  const ordinaryResult = runApplyLocalContentUpdate(
    localArgs({
      cancelQueuedFileContentSave: () => {
        canceledOrdinarySave = true;
      },
      queueFileContentSave: () => {
        ordinaryQueueCalled = true;
      },
    }),
    rawContent,
    { persist: false },
  );
  expect(ordinaryResult.status).toBe("accepted");
  expect(canceledOrdinarySave).toBe(true);
  expect(ordinaryQueueCalled).toBe(false);
});

it.each(["active", "overview"])(
  "keeps the server as CRDT author for a second %s edit before catch-up",
  (target) => {
    const before = '<main data-agent-native-node-id="root"></main>';
    const first = before.replace(
      "</main>",
      '<button data-agent-native-node-id="copy">Paste</button></main>',
    );
    const second = first.replace(
      'node-id="copy"',
      'node-id="copy" style="color:red"',
    );
    const server = new Y.Doc();
    server.getText("content").insert(0, before);
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server), "remote");
    applyTextToYDoc(server, "content", first, "server");
    const queueFileContentSave = vi.fn();
    const recordLocalContentHistoryEntry = vi.fn();
    const args = localArgs({
      activeFile: { ...activeFile, content: first },
      collabContentRef: { current: first },
      isSynced: true,
      ydoc: client,
      undoManagerRef: { current: new Y.UndoManager(client.getText("content")) },
      queueFileContentSave,
      recordLocalContentHistoryEntry,
    });
    const result =
      target === "active"
        ? runApplyLocalContentUpdate(args, second)
        : runApplyFileContentUpdate(
            {
              ...args,
              activeFile: { ...activeFile, id: "other-screen" },
              applyFileContentUpdate: vi.fn(),
              applyLocalContentUpdate: vi.fn(),
              files: [{ ...activeFile, content: first }],
              getScreenContent: () => first,
              overviewIsSynced: true,
              overviewPresenceFileId: activeFile.id,
              overviewYdoc: client,
            },
            activeFile.id,
            second,
          );
    expect(result.status).toBe("accepted");
    expect(client.getText("content").toString()).toBe(before);
    expect(queueFileContentSave).toHaveBeenCalledWith(
      activeFile.id,
      second,
      expect.objectContaining({
        syncCollab: true,
        expectedVersionHash: sourceContentHash(first),
      }),
    );
    if (target === "active")
      expect(recordLocalContentHistoryEntry).toHaveBeenCalled();
    applyTextToYDoc(server, "content", second, "server");
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server), "remote");
    expect(client.getText("content").toString()).toBe(second);
    args.undoManagerRef.current?.destroy();
    client.destroy();
    server.destroy();
  },
);

it("routes a stale callback with a destroyed matching Y.Doc through the server", () => {
  const ydoc = new Y.Doc();
  ydoc.getText("content").insert(0, oldContent);
  ydoc.destroy();
  const queueFileContentSave = vi.fn();
  const result = runApplyLocalContentUpdate(
    localArgs({ ydoc, isSynced: true, queueFileContentSave }),
    oldContent.replace("Old", "New"),
  );
  expect(result.status).toBe("accepted");
  expect(ydoc.getText("content").toString()).toBe(oldContent);
  expect(queueFileContentSave).toHaveBeenCalledWith(
    activeFile.id,
    expect.any(String),
    expect.objectContaining({ syncCollab: true }),
  );
});
