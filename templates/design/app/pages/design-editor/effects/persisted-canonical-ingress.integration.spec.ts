import { sourceContentHash } from "@shared/source-workspace";
import type { SetStateAction } from "react";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";

import { runPublishCanonicalContent } from "@/pages/design-editor/commands/publish-canonical-content";
import { runSaveFileContent } from "@/pages/design-editor/commands/save-file-content";
import type { PendingLocalFileContent } from "@/pages/design-editor/editor-state";
import { runAdoptDbFileContent } from "@/pages/design-editor/effects/adopt-db-file-content";
import { runObserveCollabText } from "@/pages/design-editor/effects/observe-collab-text";
import { runSeedCollabContent } from "@/pages/design-editor/effects/seed-collab-content";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

const fileId = "screen-persisted";
const before = "<main><p>Older persisted snapshot</p></main>";
const rawStored =
  '<main><button data-agent-native-node-id="shared">A</button><button data-agent-native-node-id="shared">B</button></main>';

function publisherHarness() {
  const pendingLocalFileContentsRef = {
    current: new Map<string, PendingLocalFileContent>(),
  };
  const queued: Array<{
    fileId: string;
    content: string;
    expectedVersionHash: string;
    syncCollab: boolean;
    immediate: boolean;
    identityMigrationSourceContent: string;
  }> = [];
  const args = {
    canEditDesignRef: { current: true },
    pendingLocalFileContentsRef,
    cancelIdentityMigration: vi.fn((id: string) => {
      pendingLocalFileContentsRef.current.delete(id);
    }),
    queueFileContentSave: vi.fn(
      (
        id: string,
        content: string,
        options: {
          expectedVersionHash: string;
          syncCollab: boolean;
          immediate: boolean;
          identityMigrationSourceContent: string;
        },
      ) => {
        queued.push({ fileId: id, content, ...options });
        pendingLocalFileContentsRef.current.set(id, {
          content,
          startedAt: queued.length,
          identityMigrationSourceContent:
            options.identityMigrationSourceContent,
        });
      },
    ),
  };
  return {
    args,
    queued,
    publish: (id: string, source: string, type?: string) =>
      runPublishCanonicalContent(args, id, source, type),
  };
}

it("renders canonical persisted source while its Yjs update is in flight", () => {
  const ydoc = new Y.Doc();
  ydoc.getText("content").insert(0, before);
  const publisher = publisherHarness();
  const expected = prepareCanonicalSourceContent(rawStored, {
    fileId,
    fileType: "html",
  }).content;
  let collabContent: string | null = before;
  let collabFileId: string | null = null;
  const latest = { current: before as string | null };
  const lastLocal = { current: before as string | null };
  const lastAppliedFileContentRef = { current: null as string | null };
  const lastApplied = { current: null as string | null };
  const preview = vi.fn(() => "applied" as const);

  runSeedCollabContent({
    activeFile: {
      id: fileId,
      filename: "screen.html",
      fileType: "html",
      content: rawStored,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    activeFileId: fileId,
    collabContentFileIdRef: { current: null },
    isSynced: true,
    lastAppliedFileContentRef,
    lastAppliedFileUpdatedAtRef: lastApplied,
    lastLocalContentRef: lastLocal,
    latestActiveContentRef: latest,
    pendingLocalFileContentsRef: publisher.args.pendingLocalFileContentsRef,
    publishCanonicalContent: publisher.publish,
    replacePreviewContent: preview,
    setCollabContent: (next: SetStateAction<string | null>) => {
      collabContent = typeof next === "function" ? next(collabContent) : next;
    },
    setCollabContentFileId: (next: SetStateAction<string | null>) => {
      collabFileId = typeof next === "function" ? next(collabFileId) : next;
    },
    setContentRenderRevision: () => {},
    undoManagerRef: { current: null },
    ydoc,
  } as never);

  expect(ydoc.getText("content").toJSON()).toBe(before);
  expect(collabContent).toBe(expected);
  expect(collabFileId).toBe(fileId);
  expect(latest.current).toBe(expected);
  expect(lastLocal.current).toBe(expected);
  expect(lastApplied.current).toBe("2026-09-13T00:00:00.000Z");
  expect(lastAppliedFileContentRef.current).toBe(rawStored);
  expect(preview).toHaveBeenCalledWith(expected, null, {
    forceFullDocument: true,
  });
  expect(publisher.queued).toEqual([
    {
      fileId,
      content: expected,
      expectedVersionHash: sourceContentHash(rawStored),
      syncCollab: true,
      immediate: true,
      identityMigrationSourceContent: rawStored,
    },
  ]);

  ydoc.destroy();
});

it("keeps SQL authority for a divergent cold Y.Doc without a proven watermark", () => {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  const rawPeer =
    '<main><button data-agent-native-node-id="shared">Peer update</button><button data-agent-native-node-id="shared">Peer sibling</button></main>';
  ytext.insert(0, rawPeer);
  const publisher = publisherHarness();
  const staleCanonical = prepareCanonicalSourceContent(rawStored, {
    fileId,
    fileType: "html",
  }).content;
  const expectedPeer = prepareCanonicalSourceContent(rawPeer, {
    fileId,
    fileType: "html",
  }).content;
  publisher.args.pendingLocalFileContentsRef.current.set(fileId, {
    content: staleCanonical,
    startedAt: 1,
    identityMigrationSourceContent: rawStored,
  });
  let collabContent: string | null = staleCanonical;
  let collabFileId: string | null = fileId;
  const latest = { current: staleCanonical as string | null };
  const lastLocal = { current: staleCanonical as string | null };
  const lastAppliedContent = { current: null as string | null };
  const lastApplied = { current: null as string | null };
  const preview = vi.fn(() => "applied" as const);
  const undoManager = { clear: vi.fn() };

  runSeedCollabContent({
    activeFile: {
      id: fileId,
      filename: "screen.html",
      fileType: "html",
      content: rawStored,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    activeFileId: fileId,
    collabContentFileIdRef: { current: fileId },
    isSynced: true,
    lastAppliedFileContentRef: lastAppliedContent,
    lastAppliedFileUpdatedAtRef: lastApplied,
    lastLocalContentRef: lastLocal,
    latestActiveContentRef: latest,
    pendingLocalFileContentsRef: publisher.args.pendingLocalFileContentsRef,
    publishCanonicalContent: publisher.publish,
    replacePreviewContent: preview,
    setCollabContent: (next: SetStateAction<string | null>) => {
      collabContent = typeof next === "function" ? next(collabContent) : next;
    },
    setCollabContentFileId: (next: SetStateAction<string | null>) => {
      collabFileId = typeof next === "function" ? next(collabFileId) : next;
    },
    setContentRenderRevision: () => {},
    undoManagerRef: { current: undoManager as never },
    ydoc,
  } as never);

  expect(ydoc.getText("content").toJSON()).toBe(rawPeer);
  expect(collabContent).toBe(staleCanonical);
  expect(collabFileId).toBe(fileId);
  expect(latest.current).toBe(staleCanonical);
  expect(lastLocal.current).toBe(staleCanonical);
  expect(lastApplied.current).toBe("2026-09-13T00:00:00.000Z");
  expect(lastAppliedContent.current).toBe(rawStored);
  expect(preview).toHaveBeenCalledWith(staleCanonical, null, {
    forceFullDocument: true,
  });
  expect(publisher.args.cancelIdentityMigration).not.toHaveBeenCalled();
  expect(publisher.queued).toEqual([]);
  expect(undoManager.clear).not.toHaveBeenCalled();

  ydoc.destroy();
});

it("preserves peer edits against unchanged SQL and adopts changed same-millisecond source", async () => {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  const rawPeer =
    '<main><button data-agent-native-node-id="shared">Peer update</button><button data-agent-native-node-id="shared">Peer sibling</button></main>';
  const expectedStored = prepareCanonicalSourceContent(rawStored, {
    fileId,
    fileType: "html",
  }).content;
  const expectedPeer = prepareCanonicalSourceContent(rawPeer, {
    fileId,
    fileType: "html",
  }).content;
  ytext.insert(0, expectedStored);
  const publisher = publisherHarness();
  publisher.args.pendingLocalFileContentsRef.current.set(fileId, {
    content: expectedStored,
    startedAt: 1,
    identityMigrationSourceContent: rawStored,
  });
  let collabContent: string | null = expectedStored;
  let collabFileId: string | null = fileId;
  const collabContentRef = { current: expectedStored as string | null };
  const collabContentFileIdRef = { current: fileId as string | null };
  const latest = { current: expectedStored as string | null };
  const lastLocal = { current: expectedStored as string | null };
  const lastAppliedContent = { current: rawStored as string | null };
  const lastApplied = { current: "2026-09-13T00:00:00.000Z" as string | null };
  const documentContent = { current: rawStored as string | null };
  const documentUpdatedAt = {
    current: "2026-09-13T00:00:00.000Z" as string | null,
  };
  const preview = vi.fn(() => "applied" as const);
  const sourceFile = {
    id: fileId,
    filename: "screen.html",
    fileType: "html",
    content: rawStored,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
  };
  const setCollabContent = (next: SetStateAction<string | null>) => {
    collabContent = typeof next === "function" ? next(collabContent) : next;
    collabContentRef.current = collabContent;
  };
  const setCollabFileId = (next: SetStateAction<string | null>) => {
    collabFileId = typeof next === "function" ? next(collabFileId) : next;
    collabContentFileIdRef.current = collabFileId;
  };
  const seed = () =>
    runSeedCollabContent({
      activeFile: sourceFile,
      activeFileId: fileId,
      collabContentFileIdRef,
      isSynced: true,
      lastAppliedFileContentRef: lastAppliedContent,
      lastAppliedFileUpdatedAtRef: lastApplied,
      lastLocalContentRef: lastLocal,
      latestActiveContentRef: latest,
      pendingLocalFileContentsRef: publisher.args.pendingLocalFileContentsRef,
      publishCanonicalContent: publisher.publish,
      replacePreviewContent: preview,
      setCollabContent,
      setCollabContentFileId: setCollabFileId,
      setContentRenderRevision: () => {},
      undoManagerRef: { current: null },
      ydoc,
    } as never);
  const observerCleanup = runObserveCollabText({
    activeFileId: fileId,
    agentActive: false,
    documentFileContentRef: documentContent,
    documentFileUpdatedAtRef: documentUpdatedAt,
    fileType: "html",
    isSynced: true,
    lastAppliedFileContentRef: lastAppliedContent,
    lastAppliedFileUpdatedAtRef: lastApplied,
    lastLocalContentRef: lastLocal,
    latestActiveContentRef: latest,
    pendingLocalFileContentsRef: publisher.args.pendingLocalFileContentsRef,
    publishCanonicalContent: publisher.publish,
    recordExternalContentHistoryCheckpoint: vi.fn(),
    replacePreviewContent: preview,
    setCollabContent,
    setCollabContentFileId: setCollabFileId,
    setContentRenderRevision: () => {},
    setHoveredElement: vi.fn(),
    setSelectedElement: vi.fn(),
    undoManagerRef: { current: null },
    ydoc,
  } as never);

  ydoc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, rawPeer);
  }, "remote-peer-update");
  expect(collabContent).toBe(expectedPeer);
  expect(lastApplied.current).toBe("2026-09-13T00:00:00.000Z");
  expect(lastAppliedContent.current).toBe(rawStored);
  expect(publisher.args.cancelIdentityMigration).toHaveBeenCalledWith(fileId);
  expect(publisher.queued).toHaveLength(1);
  expect(publisher.queued[0]?.identityMigrationSourceContent).toBe(rawPeer);

  seed();
  expect(ytext.toJSON()).toBe(rawPeer);
  expect(collabContent).toBe(expectedPeer);
  expect(lastAppliedContent.current).toBe(rawStored);
  expect(publisher.queued).toHaveLength(1);

  const saveChains = { current: {} as Record<string, Promise<void>> };
  const latestSave = { current: {} as Record<string, never> };
  const invalidateQueries = vi.fn();
  const rollbackPendingLocalFileContent = vi.fn(
    (id: string, expectedContent?: string) => {
      const current =
        publisher.args.pendingLocalFileContentsRef.current.get(id);
      if (!current || current.content !== expectedContent) return;
      publisher.args.pendingLocalFileContentsRef.current.delete(id);
    },
  );
  const pendingSave = {
    id: fileId,
    content: expectedPeer,
    identityMigrationSourceContent: rawPeer,
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 1,
    expectedVersionHash: sourceContentHash(rawPeer),
  };
  const previousNavigator = globalThis.navigator;
  vi.stubGlobal("navigator", { onLine: true });
  try {
    runSaveFileContent(
      {
        acknowledgeOutboxEntry: vi.fn(async () => {}),
        canEditDesignRef: { current: true },
        createFileSaveOutboxEntry: vi.fn(() => null),
        fileSaveChainsRef: saveChains,
        journalOutboxEntry: vi.fn(async () => true),
        latestFileSaveForUnloadRef: latestSave as never,
        rollbackPendingLocalFileContent,
        markPendingLocalFileContent: vi.fn(),
        queryClient: { invalidateQueries } as never,
        setPatchProof: vi.fn(),
        t: (key: string) => key,
        updateFileMutation: {
          mutateAsync: vi.fn(async () => {
            const error = new Error(
              "Source file changed since it was read. Re-read the file and retry.",
            ) as Error & { statusCode: number };
            error.statusCode = 409;
            throw error;
          }),
        } as never,
        warnChangesWillRetry: vi.fn(),
      } as never,
      pendingSave,
    );
    await saveChains.current[fileId];
  } finally {
    vi.stubGlobal("navigator", previousNavigator);
  }
  expect(rollbackPendingLocalFileContent).toHaveBeenCalledWith(
    fileId,
    expectedPeer,
  );
  expect(publisher.args.pendingLocalFileContentsRef.current.has(fileId)).toBe(
    false,
  );
  expect(invalidateQueries).toHaveBeenCalled();

  seed();
  expect(ytext.toJSON()).toBe(rawPeer);
  expect(collabContent).toBe(expectedPeer);
  expect(publisher.queued).toHaveLength(1);
  expect(
    publisher.queued.map((entry) => entry.identityMigrationSourceContent),
  ).toEqual([rawPeer]);

  const recoveryTimer = { current: null as number | null };
  const adopt = (file: typeof sourceFile) =>
    runAdoptDbFileContent({
      activeFile: file,
      agentActive: false,
      clearStaleAgentCollabRecovery: vi.fn(),
      collabContent,
      collabContentFileId: collabFileId,
      collabContentFileIdRef: collabContentFileIdRef,
      collabContentRef,
      documentFileContentRef: documentContent,
      documentFileUpdatedAtRef: documentUpdatedAt,
      isLeadClient: true,
      isSynced: true,
      lastAppliedFileContentRef: lastAppliedContent,
      lastAppliedFileUpdatedAtRef: lastApplied,
      lastLocalContentRef: lastLocal,
      latestActiveContentRef: latest,
      publishCanonicalContent: publisher.publish,
      recordExternalContentHistoryCheckpoint: vi.fn(),
      replacePreviewContent: preview,
      setCollabContent,
      setCollabContentFileId: setCollabFileId,
      setContentRenderRevision: () => {},
      staleAgentCollabRecoveryTimerRef: recoveryTimer,
      undoManagerRef: { current: null },
      ydoc,
    } as never);

  adopt(sourceFile);
  expect(collabContent).toBe(expectedPeer);
  expect(ytext.toJSON()).toBe(rawPeer);
  expect(lastAppliedContent.current).toBe(rawStored);
  expect(publisher.queued).toHaveLength(1);

  const rawSameMillisecondUpdate =
    "<main><p>Changed SQL source at the same timestamp</p></main>";
  const expectedSameMillisecondUpdate = prepareCanonicalSourceContent(
    rawSameMillisecondUpdate,
    { fileId, fileType: "html" },
  ).content;
  const sameMillisecondSource = {
    ...sourceFile,
    content: rawSameMillisecondUpdate,
    updatedAt: sourceFile.updatedAt,
  };
  documentContent.current = rawSameMillisecondUpdate;
  documentUpdatedAt.current = sameMillisecondSource.updatedAt;
  adopt(sameMillisecondSource);
  expect(collabContent).toBe(expectedSameMillisecondUpdate);
  expect(ytext.toJSON()).toBe(rawPeer);
  expect(lastApplied.current).toBe(sameMillisecondSource.updatedAt);
  expect(lastAppliedContent.current).toBe(rawSameMillisecondUpdate);
  expect(
    publisher.queued.map((entry) => entry.identityMigrationSourceContent),
  ).toEqual([rawPeer, rawSameMillisecondUpdate]);

  observerCleanup?.();
  ydoc.destroy();
});

it("adopts newly persisted source through the canonical publisher without a second Yjs writer", () => {
  const ydoc = new Y.Doc();
  ydoc.getText("content").insert(0, before);
  const publisher = publisherHarness();
  const expected = prepareCanonicalSourceContent(rawStored, {
    fileId,
    fileType: "html",
  }).content;
  let collabContent: string | null = before;
  let collabContentFileId: string | null = fileId;
  const collabContentRef = { current: before as string | null };
  const collabContentFileIdRef = { current: fileId as string | null };
  const latest = { current: before as string | null };
  const lastLocal = { current: before as string | null };
  const lastApplied = { current: "2026-09-12T00:00:00.000Z" as string | null };
  const lastAppliedContent = { current: before as string | null };
  const checkpoint = vi.fn();
  const preview = vi.fn(() => "applied" as const);

  runAdoptDbFileContent({
    activeFile: {
      id: fileId,
      filename: "screen.html",
      fileType: "html",
      content: rawStored,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    agentActive: false,
    clearStaleAgentCollabRecovery: vi.fn(),
    collabContent,
    collabContentFileId,
    collabContentFileIdRef,
    collabContentRef,
    documentFileContentRef: { current: rawStored },
    documentFileUpdatedAtRef: { current: "2026-09-13T00:00:00.000Z" },
    isLeadClient: true,
    isSynced: true,
    lastAppliedFileContentRef: lastAppliedContent,
    lastAppliedFileUpdatedAtRef: lastApplied,
    lastLocalContentRef: lastLocal,
    latestActiveContentRef: latest,
    publishCanonicalContent: publisher.publish,
    recordExternalContentHistoryCheckpoint: checkpoint,
    replacePreviewContent: preview,
    setCollabContent: (next: SetStateAction<string | null>) => {
      collabContent = typeof next === "function" ? next(collabContent) : next;
      collabContentRef.current = collabContent;
    },
    setCollabContentFileId: (next: SetStateAction<string | null>) => {
      collabContentFileId =
        typeof next === "function" ? next(collabContentFileId) : next;
      collabContentFileIdRef.current = collabContentFileId;
    },
    setContentRenderRevision: () => {},
    staleAgentCollabRecoveryTimerRef: { current: null },
    undoManagerRef: { current: null },
    ydoc,
  } as never);

  expect(ydoc.getText("content").toJSON()).toBe(before);
  expect(collabContent).toBe(expected);
  expect(collabContentFileId).toBe(fileId);
  expect(latest.current).toBe(expected);
  expect(lastLocal.current).toBe(expected);
  expect(lastApplied.current).toBe("2026-09-13T00:00:00.000Z");
  expect(lastAppliedContent.current).toBe(rawStored);
  expect(preview).toHaveBeenCalledWith(expected, null, {
    forceFullDocument: true,
  });
  expect(checkpoint).toHaveBeenCalledWith({ fileId, before, after: expected });
  expect(publisher.queued).toEqual([
    {
      fileId,
      content: expected,
      expectedVersionHash: sourceContentHash(rawStored),
      syncCollab: true,
      immediate: true,
      identityMigrationSourceContent: rawStored,
    },
  ]);

  ydoc.destroy();
});
