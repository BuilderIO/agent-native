import { sourceContentHash } from "@shared/source-workspace";
import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { runPublishCanonicalContent } from "@/pages/design-editor/commands/publish-canonical-content";
import type { PendingLocalFileContent } from "@/pages/design-editor/editor-state";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { runObserveCollabText } from "./observe-collab-text";

const FILE_ID = "screen-canonical-publication";
const BEFORE =
  '<main><button id="duplicate">Before</button><button id="duplicate">Peer</button></main>';
const REMOTE =
  '<main><button id="duplicate">AI update</button><button id="duplicate">Peer</button></main>';

function setRef<T>(ref: { current: T }, next: T | ((previous: T) => T)) {
  ref.current =
    typeof next === "function"
      ? (next as (previous: T) => T)(ref.current)
      : next;
}

function createPublisher() {
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
  const cancelIdentityMigration = vi.fn((fileId: string) => {
    pendingLocalFileContentsRef.current.delete(fileId);
  });
  const queueFileContentSave = vi.fn(
    (
      fileId: string,
      content: string,
      options: {
        expectedVersionHash: string;
        syncCollab: boolean;
        immediate: boolean;
        identityMigrationSourceContent: string;
      },
    ) => {
      queued.push({ fileId, content, ...options });
      pendingLocalFileContentsRef.current.set(fileId, {
        content,
        startedAt: queued.length,
        identityMigrationSourceContent: options.identityMigrationSourceContent,
      });
    },
  );
  const args = {
    canEditDesignRef: { current: true },
    pendingLocalFileContentsRef,
    cancelIdentityMigration,
    queueFileContentSave,
  };
  return {
    args,
    pendingLocalFileContentsRef,
    queued,
    cancelIdentityMigration,
    queueFileContentSave,
    publish: (fileId: string, sourceContent: string, fileType?: string) =>
      runPublishCanonicalContent(args, fileId, sourceContent, fileType),
  };
}

describe("runObserveCollabText canonical publication", () => {
  it("lets a newer remote source yield past an older identity migration and checkpoints canonical bytes", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    doc.transact(() => text.insert(0, BEFORE), "seed");
    const staleCanonical = prepareCanonicalSourceContent(BEFORE, {
      fileId: FILE_ID,
    }).content;
    const publisher = createPublisher();
    const pendingLocalFileContentsRef = publisher.pendingLocalFileContentsRef;
    const pendingLocal = pendingLocalFileContentsRef.current;
    pendingLocal.set(FILE_ID, {
      content: staleCanonical,
      startedAt: 1,
      identityMigrationSourceContent: BEFORE,
    });
    const latestActiveContentRef = { current: BEFORE as string | null };
    const lastLocalContentRef = { current: BEFORE as string | null };
    const collabContentRef = { current: null as string | null };
    const collabContentFileIdRef = { current: null as string | null };
    const renderRevisionRef = { current: 0 };
    const publishCanonicalContent = vi.fn(publisher.publish);
    const recordExternalContentHistoryCheckpoint = vi.fn();
    const replacePreviewContent = vi.fn(() => "applied" as const);
    const lastAppliedFileContentRef = { current: BEFORE as string | null };
    const lastAppliedFileUpdatedAtRef = { current: "T1" as string | null };
    const documentFileContentRef = { current: REMOTE as string | null };
    const documentFileUpdatedAtRef = { current: "T2" as string | null };
    const undoManager = new Y.UndoManager(text);
    const cleanup = runObserveCollabText({
      activeFileId: FILE_ID,
      agentActive: true,
      documentFileContentRef,
      documentFileUpdatedAtRef,
      fileType: "html",
      isSynced: true,
      lastAppliedFileContentRef,
      lastAppliedFileUpdatedAtRef,
      lastLocalContentRef,
      latestActiveContentRef,
      pendingLocalFileContentsRef,
      publishCanonicalContent,
      recordExternalContentHistoryCheckpoint,
      replacePreviewContent,
      setCollabContent: (next: SetStateAction<string | null>) =>
        setRef(collabContentRef, next),
      setCollabContentFileId: (next: SetStateAction<string | null>) =>
        setRef(collabContentFileIdRef, next),
      setContentRenderRevision: (next: SetStateAction<number>) =>
        setRef(renderRevisionRef, next),
      setHoveredElement: vi.fn(),
      setSelectedElement: vi.fn(),
      undoManagerRef: { current: undoManager },
      ydoc: doc,
    } as never);

    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, REMOTE);
    }, "remote-agent-update");

    const canonicalRemote = prepareCanonicalSourceContent(REMOTE, {
      fileId: FILE_ID,
      fileType: "html",
    }).content;
    expect(publishCanonicalContent).toHaveBeenCalledWith(
      FILE_ID,
      REMOTE,
      "html",
    );
    expect(publisher.cancelIdentityMigration).toHaveBeenCalledWith(FILE_ID);
    expect(publisher.queued).toEqual([
      {
        fileId: FILE_ID,
        content: canonicalRemote,
        expectedVersionHash: sourceContentHash(REMOTE),
        identityMigrationSourceContent: REMOTE,
        immediate: true,
        syncCollab: true,
      },
    ]);
    expect(text.toJSON()).toBe(REMOTE);
    expect(collabContentRef.current).toBe(canonicalRemote);
    expect(collabContentFileIdRef.current).toBe(FILE_ID);
    expect(latestActiveContentRef.current).toBe(canonicalRemote);
    expect(lastLocalContentRef.current).toBe(canonicalRemote);
    expect(lastAppliedFileUpdatedAtRef.current).toBe("T2");
    expect(lastAppliedFileContentRef.current).toBe(REMOTE);
    expect(renderRevisionRef.current).toBe(0);
    expect(replacePreviewContent).toHaveBeenCalledWith(canonicalRemote, null, {
      forceFullDocument: true,
    });
    expect(recordExternalContentHistoryCheckpoint).toHaveBeenCalledWith({
      fileId: FILE_ID,
      before: BEFORE,
      after: canonicalRemote,
    });
    expect(pendingLocal.get(FILE_ID)).toEqual({
      content: canonicalRemote,
      startedAt: 1,
      identityMigrationSourceContent: REMOTE,
    });
    expect(pendingLocal.get(FILE_ID)?.content).not.toBe(staleCanonical);
    expect(publisher.publish(FILE_ID, REMOTE, "html")).toBe(canonicalRemote);
    expect(publisher.queued).toHaveLength(1);

    const unwatermarkedRemote = "<main><p>Unwatermarked peer source</p></main>";
    documentFileContentRef.current = unwatermarkedRemote;
    documentFileUpdatedAtRef.current = null;
    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, unwatermarkedRemote);
    }, "remote-peer-without-sql-watermark");
    expect(lastAppliedFileUpdatedAtRef.current).toBe("T2");
    expect(lastAppliedFileContentRef.current).toBe(REMOTE);

    cleanup?.();
    undoManager.destroy();
    doc.destroy();
  });

  it("does not let source identity maintenance replace pending user content", () => {
    const publisher = createPublisher();
    const userContent =
      '<main data-agent-native-node-id="user">User edit</main>';
    publisher.pendingLocalFileContentsRef.current.set(FILE_ID, {
      content: userContent,
      startedAt: 1,
    });

    const result = publisher.publish(FILE_ID, REMOTE, "html");

    expect(result).toBe(userContent);
    expect(publisher.queued).toEqual([]);
    expect(publisher.cancelIdentityMigration).not.toHaveBeenCalled();
    expect(publisher.pendingLocalFileContentsRef.current.get(FILE_ID)).toEqual({
      content: userContent,
      startedAt: 1,
    });
  });

  it("does not canonicalize URL-backed or non-HTML sources", () => {
    const publisher = createPublisher();
    const url = "https://example.test/live-screen";
    const scriptSource = '<div id="duplicate">Script source</div>';

    expect(publisher.publish(FILE_ID, url, "html")).toBe(url);
    expect(publisher.publish(FILE_ID, scriptSource, "jsx")).toBe(scriptSource);
    expect(publisher.queued).toEqual([]);
  });
});
