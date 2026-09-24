// @vitest-environment happy-dom

import { act, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingLocalFileContent } from "../editor-state";
import { runPublishCanonicalContent } from "./publish-canonical-content";

const nonactiveFileId = "nonactive-screen";
const activeFileId = "active-screen";
const rawInitialContent =
  '<html><body><button data-label="initial">Initial</button></body></html>';
const rawReplacementContent =
  '<html><body><button data-label="replacement">Replacement</button></body></html>';

type QueueFileContentSave = (
  fileId: string,
  content: string,
  options: {
    expectedVersionHash: string;
    syncCollab: boolean;
    immediate: boolean;
    identityMigrationSourceContent: string;
  },
) => void;

type HarnessProps = {
  canEditDesign: boolean;
  serverFiles: Array<{ id: string; content: string; fileType: string }>;
  baselineScheduling?: boolean;
  onPermissionSync: (canEditDesign: boolean) => void;
  queueFileContentSave: QueueFileContentSave;
  pendingLocalFileContentsRef: React.RefObject<
    Map<string, PendingLocalFileContent>
  >;
};

function PublicationHarness({
  canEditDesign,
  serverFiles,
  baselineScheduling = false,
  onPermissionSync,
  queueFileContentSave,
  pendingLocalFileContentsRef,
}: HarnessProps) {
  const canEditDesignRef = useRef(canEditDesign);
  const cancelIdentityMigration = useCallback(
    (fileId: string) => {
      pendingLocalFileContentsRef.current.delete(fileId);
    },
    [pendingLocalFileContentsRef],
  );
  const publishCanonicalContent = useCallback(
    (fileId: string, sourceContent: string, fileType: string) =>
      runPublishCanonicalContent(
        {
          canEditDesignRef,
          pendingLocalFileContentsRef,
          cancelIdentityMigration,
          queueFileContentSave,
        },
        fileId,
        sourceContent,
        fileType,
      ),
    [
      cancelIdentityMigration,
      pendingLocalFileContentsRef,
      queueFileContentSave,
    ],
  );

  useLayoutEffect(() => {
    if (baselineScheduling) return;
    canEditDesignRef.current = canEditDesign;
    onPermissionSync(canEditDesign);
  }, [baselineScheduling, canEditDesign, onPermissionSync]);
  useEffect(() => {
    if (!baselineScheduling) return;
    canEditDesignRef.current = canEditDesign;
    onPermissionSync(canEditDesign);
  }, [baselineScheduling, canEditDesign, onPermissionSync]);

  useLayoutEffect(
    () => {
      for (const file of serverFiles) {
        if (file.id === activeFileId) continue;
        publishCanonicalContent(file.id, file.content, file.fileType);
      }
    },
    baselineScheduling
      ? [serverFiles, publishCanonicalContent]
      : [serverFiles, publishCanonicalContent, canEditDesign],
  );

  return null;
}

describe("canonical source publication across editor permission changes", () => {
  let container: HTMLDivElement;
  let root: Root;
  let pendingLocalFileContentsRef: React.RefObject<
    Map<string, PendingLocalFileContent>
  >;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    pendingLocalFileContentsRef = { current: new Map() };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("queues only the nonactive migration after permission sync and skips it on editor-to-readonly", async () => {
    let sourceContent = rawInitialContent;
    const serverFiles = [
      {
        id: nonactiveFileId,
        fileType: "html",
        get content() {
          return sourceContent;
        },
      },
      { id: activeFileId, fileType: "html", content: rawInitialContent },
    ];
    const events: string[] = [];
    const queueFileContentSave = vi.fn<QueueFileContentSave>(
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
        events.push(`queue:${fileId}`);
        pendingLocalFileContentsRef.current.set(fileId, {
          content,
          startedAt: 1,
          identityMigrationSourceContent:
            options.identityMigrationSourceContent,
        });
      },
    );
    const onPermissionSync = vi.fn((canEditDesign: boolean) => {
      events.push(`permission:${canEditDesign}`);
    });

    const render = async (canEditDesign: boolean) => {
      await act(async () =>
        root.render(
          <PublicationHarness
            canEditDesign={canEditDesign}
            onPermissionSync={onPermissionSync}
            pendingLocalFileContentsRef={pendingLocalFileContentsRef}
            queueFileContentSave={queueFileContentSave}
            serverFiles={serverFiles}
          />,
        ),
      );
    };

    await render(false);
    expect(queueFileContentSave).not.toHaveBeenCalled();

    await render(true);
    expect(queueFileContentSave).toHaveBeenCalledTimes(1);
    expect(queueFileContentSave).toHaveBeenCalledWith(
      nonactiveFileId,
      expect.stringContaining("data-agent-native-node-id"),
      expect.objectContaining({
        identityMigrationSourceContent: rawInitialContent,
        immediate: true,
        syncCollab: true,
      }),
    );
    expect(events.indexOf("permission:true")).toBeLessThan(
      events.indexOf(`queue:${nonactiveFileId}`),
    );

    sourceContent = rawReplacementContent;
    await render(false);
    expect(queueFileContentSave).toHaveBeenCalledTimes(1);
    expect(pendingLocalFileContentsRef.current.has(nonactiveFileId)).toBe(
      false,
    );
  });

  it("reproduces the old passive-ref/missing-dependency ordering as a failing control", async () => {
    const serverFiles = [
      { id: nonactiveFileId, fileType: "html", content: rawInitialContent },
      { id: activeFileId, fileType: "html", content: rawInitialContent },
    ];
    const queueFileContentSave = vi.fn<QueueFileContentSave>();

    await act(async () =>
      root.render(
        <PublicationHarness
          baselineScheduling
          canEditDesign={false}
          onPermissionSync={vi.fn()}
          pendingLocalFileContentsRef={pendingLocalFileContentsRef}
          queueFileContentSave={queueFileContentSave}
          serverFiles={serverFiles}
        />,
      ),
    );
    await act(async () =>
      root.render(
        <PublicationHarness
          baselineScheduling
          canEditDesign
          onPermissionSync={vi.fn()}
          pendingLocalFileContentsRef={pendingLocalFileContentsRef}
          queueFileContentSave={queueFileContentSave}
          serverFiles={serverFiles}
        />,
      ),
    );

    expect(queueFileContentSave).not.toHaveBeenCalled();
  });
});
