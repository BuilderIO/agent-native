import { sourceContentHash } from "@shared/source-workspace";
import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { runObserveCollabText } from "@/pages/design-editor/effects/observe-collab-text";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import {
  createLinkedComponentMutationQueue,
  type LinkedComponentActionResult,
  type LinkedComponentMutationQueueArgs,
} from "./linked-component-mutation";

const FILE_ID = "linked-screen";
const BEFORE =
  '<main data-agent-native-node-id="main"><button data-agent-native-node-id="button">Before</button></main>';
const ACCEPTED =
  '<main data-agent-native-node-id="main"><button data-agent-native-node-id="button">Linked edit</button></main>';
const OTHER =
  '<main data-agent-native-node-id="main"><button data-agent-native-node-id="button">Peer edit</button></main>';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function actionResult(after: string): LinkedComponentActionResult {
  return {
    persisted: true,
    changes: [
      {
        fileId: FILE_ID,
        before: BEFORE,
        after,
        beforeVersionHash: sourceContentHash(BEFORE),
        afterVersionHash: sourceContentHash(after),
        updatedAt: "v1",
      },
    ],
    sourceBases: [
      {
        fileId: FILE_ID,
        versionHash: sourceContentHash(after),
        updatedAt: "v1",
      },
    ],
  };
}

function createHarness() {
  const canonicalize = (fileId: string, content: string) =>
    prepareCanonicalSourceContent(content, { fileId, fileType: "html" })
      .content;
  const content = new Map([[FILE_ID, canonicalize(FILE_ID, BEFORE)]]);
  const sourceBase = new Map([[FILE_ID, BEFORE]]);
  const reserveCommit = vi.fn();
  const reserveCancel = vi.fn();
  const reserveContentHistory = vi.fn(() => ({
    commit: reserveCommit,
    cancel: reserveCancel,
  }));
  const recordExternal = vi.fn();
  const fileSaveChainsRef = { current: {} as Record<string, Promise<void>> };
  let queue!: ReturnType<typeof createLinkedComponentMutationQueue>;
  const args: LinkedComponentMutationQueueArgs = {
    designId: "design-1",
    fileIds: () => [FILE_ID],
    getContent: (fileId) => content.get(fileId) ?? "",
    getSourceBaseContent: (fileId) => sourceBase.get(fileId) ?? "",
    canonicalizeSourceContent: canonicalize,
    flushPendingSaves: vi.fn(),
    hasPendingSave: () => false,
    getPendingSave: () => undefined,
    fileSaveChainsRef,
    pendingFileSavesRef: { current: {} },
    invokeAction: vi.fn(async () => ({ persisted: false })),
    applyFileContentUpdate: vi.fn((fileId: string, next: string) => {
      content.set(fileId, canonicalize(fileId, next));
      sourceBase.set(fileId, next);
      return {
        status: "accepted" as const,
        content: canonicalize(fileId, next),
        nodeIdMap: new Map(),
      };
    }),
    getCurrentSelection: () => ({
      activeFileId: FILE_ID,
      selectedLayerIds: [],
      overviewSelectedScreenIds: [],
    }),
    reserveContentHistory,
    waitForHostWrites: vi.fn(async () => {}),
    syncUndoRedoState: vi.fn(),
    refreshAfterConflict: vi.fn(),
    reportFailure: vi.fn(),
  };
  queue = createLinkedComponentMutationQueue(args);

  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, BEFORE);
  const latestContent = {
    current: canonicalize(FILE_ID, BEFORE) as string | null,
  };
  const collabContent = {
    current: canonicalize(FILE_ID, BEFORE) as string | null,
  };
  const cleanup = runObserveCollabText({
    activeFileId: FILE_ID,
    agentActive: true,
    documentFileContentRef: { current: BEFORE },
    documentFileUpdatedAtRef: { current: "v0" },
    fileType: "html",
    isSynced: true,
    lastAppliedFileContentRef: { current: BEFORE },
    lastAppliedFileUpdatedAtRef: { current: "v0" },
    lastLocalContentRef: { current: latestContent.current },
    latestActiveContentRef: latestContent,
    pendingLocalFileContentsRef: { current: new Map() },
    publishCanonicalContent: canonicalize,
    recordExternalContentHistoryCheckpoint: (change: ContentHistoryChange) => {
      const forwarded = queue.interceptExternalCheckpoint(change, () =>
        recordExternal(change),
      );
      if (!forwarded) recordExternal(change);
    },
    replacePreviewContent: () => "applied",
    setCollabContent: (update: SetStateAction<string | null>) => {
      collabContent.current =
        typeof update === "function" ? update(collabContent.current) : update;
      content.set(FILE_ID, collabContent.current ?? "");
    },
    setCollabContentFileId: () => {},
    setContentRenderRevision: () => {},
    setHoveredElement: () => {},
    setSelectedElement: () => {},
    undoManagerRef: { current: null },
    ydoc: doc,
  } as never);

  return {
    args,
    cleanup,
    collabContent,
    content,
    doc,
    latestContent,
    queue,
    recordExternal,
    reserveCancel,
    reserveCommit,
    reserveContentHistory,
    sourceBase,
    text,
  };
}

describe("linked component queue at collab observer ingress", () => {
  it("reserves one history commit and absorbs the early observer echo after acceptance", async () => {
    const response = deferred<LinkedComponentActionResult>();
    const actionStarted = deferred<void>();
    const setup = createHarness();
    vi.mocked(setup.args.invokeAction).mockImplementation(() => {
      actionStarted.resolve();
      return response.promise;
    });

    const operation = setup.queue.enqueue(FILE_ID, "button", {
      kind: "textContent",
      value: "Linked edit",
    });
    await actionStarted.promise;
    setup.doc.transact(() => {
      setup.text.delete(0, setup.text.length);
      setup.text.insert(0, ACCEPTED);
    }, "remote-linked-action-echo");

    expect(setup.reserveContentHistory).toHaveBeenCalledTimes(1);
    expect(setup.reserveCommit).not.toHaveBeenCalled();
    expect(setup.recordExternal).not.toHaveBeenCalled();
    response.resolve(actionResult(ACCEPTED));
    await operation;

    expect(setup.reserveCommit).toHaveBeenCalledTimes(1);
    expect(setup.reserveCommit).toHaveBeenCalledWith([
      {
        fileId: FILE_ID,
        before: prepareCanonicalSourceContent(BEFORE, {
          fileId: FILE_ID,
          fileType: "html",
        }).content,
        after: prepareCanonicalSourceContent(ACCEPTED, {
          fileId: FILE_ID,
          fileType: "html",
        }).content,
      },
    ]);
    expect(setup.reserveCancel).not.toHaveBeenCalled();
    expect(setup.recordExternal).not.toHaveBeenCalled();
    expect(setup.args.waitForHostWrites).toHaveBeenCalledTimes(2);
    expect(setup.args.syncUndoRedoState).toHaveBeenCalled();
    expect(setup.content.get(FILE_ID)).toBe(
      prepareCanonicalSourceContent(ACCEPTED, {
        fileId: FILE_ID,
        fileType: "html",
      }).content,
    );
    expect(setup.sourceBase.get(FILE_ID)).toBe(ACCEPTED);
    setup.cleanup?.();
    setup.doc.destroy();
  });

  it("forwards different observer bytes as external history and rejects the stale action", async () => {
    const response = deferred<LinkedComponentActionResult>();
    const actionStarted = deferred<void>();
    const setup = createHarness();
    vi.mocked(setup.args.invokeAction).mockImplementation(() => {
      actionStarted.resolve();
      return response.promise;
    });

    const operation = setup.queue.enqueue(FILE_ID, "button", {
      kind: "textContent",
      value: "Linked edit",
    });
    await actionStarted.promise;
    setup.doc.transact(() => {
      setup.text.delete(0, setup.text.length);
      setup.text.insert(0, OTHER);
    }, "remote-peer-edit");

    expect(setup.recordExternal).not.toHaveBeenCalled();
    response.resolve(actionResult(ACCEPTED));
    await expect(operation).rejects.toThrow("newer editor change arrived");

    expect(setup.recordExternal).toHaveBeenCalledWith({
      fileId: FILE_ID,
      before: prepareCanonicalSourceContent(BEFORE, {
        fileId: FILE_ID,
        fileType: "html",
      }).content,
      after: prepareCanonicalSourceContent(OTHER, {
        fileId: FILE_ID,
        fileType: "html",
      }).content,
    });
    expect(setup.reserveCommit).toHaveBeenCalledTimes(1);
    expect(setup.reserveCancel).not.toHaveBeenCalled();
    expect(setup.args.reportFailure).toHaveBeenCalledWith(
      expect.stringContaining("newer editor change arrived"),
    );
    expect(setup.sourceBase.get(FILE_ID)).toBe(BEFORE);
    setup.cleanup?.();
    setup.doc.destroy();
  });
});
