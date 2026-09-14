import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";

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
      queueFileContentSave: (_fileId, content, options) =>
        (queued = { content, options }),
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
  const migrationResult = runApplyLocalContentUpdate(
    localArgs({
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
