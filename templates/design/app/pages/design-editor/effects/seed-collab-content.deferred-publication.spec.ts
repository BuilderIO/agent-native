import { expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { PendingLocalFileContent } from "@/pages/design-editor/editor-state";
import { runSeedCollabContent } from "@/pages/design-editor/effects/seed-collab-content";

it("keeps a deferred upload out of collaboration seeding", () => {
  const fileId = "screen-1";
  const remoteContent = "<main>remote source</main>";
  const uploadedSource = "<main>uploaded source candidate</main>";
  const ydoc = new Y.Doc();
  ydoc.getText("content").insert(0, remoteContent);
  const pendingLocalFileContentsRef = {
    current: new Map<string, PendingLocalFileContent>([
      [
        fileId,
        {
          content: uploadedSource,
          startedAt: 1,
          deferCollabReconcile: true,
        },
      ],
    ]),
  };
  const setCollabContent = vi.fn();
  const setCollabContentFileId = vi.fn();
  const replacePreviewContent = vi.fn(() => "applied" as const);
  const latestActiveContentRef = { current: remoteContent };

  try {
    runSeedCollabContent({
      activeFile: {
        id: fileId,
        filename: "index.html",
        fileType: "html",
        content: remoteContent,
        updatedAt: "T2",
        createdAt: "T1",
      },
      activeFileId: fileId,
      collabContentFileIdRef: { current: fileId },
      isSynced: true,
      lastAppliedFileContentRef: { current: remoteContent },
      lastAppliedFileUpdatedAtRef: { current: "T2" },
      lastLocalContentRef: { current: remoteContent },
      latestActiveContentRef,
      pendingLocalFileContentsRef,
      publishCanonicalContent: vi.fn((_, source) => source),
      replacePreviewContent,
      setCollabContent,
      setCollabContentFileId,
      setContentRenderRevision: vi.fn(),
      ydoc,
    });

    expect(ydoc.getText("content").toString()).toBe(remoteContent);
    expect(latestActiveContentRef.current).toBe(remoteContent);
    expect(setCollabContent.mock.calls.flat()).not.toContain(uploadedSource);
    expect(setCollabContentFileId.mock.calls.flat()).not.toContain(
      uploadedSource,
    );
    expect(replacePreviewContent.mock.calls.flat()).not.toContain(
      uploadedSource,
    );
  } finally {
    ydoc.destroy();
  }
});
