import { buildCodeLayerProjection } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import { expect, it, vi } from "vitest";

import {
  runCommitVisualStyles,
  type CommitVisualStylesArgs,
} from "@/pages/design-editor/commands/commit-visual-styles";

const ref = <T>(current: T) => ({ current });

it("uses the projected source and refuses a style commit while source actions are gated", () => {
  vi.stubGlobal("window", {});
  const fileId = "screen-1";
  const activeContent =
    '<html><body><h1 id="target" style="color: red">Saved</h1></body></html>';
  const pendingContent =
    '<html><body><main data-pending="true"><h1 id="target" style="color: blue">Pending</h1></main></body></html>';
  const runtimeSnapshot =
    '<html><head><style>h1 { color: rgb(0, 0, 255); }</style></head><body><div id="root"><main data-pending="true"><h1 id="target" style="color: rgb(0, 0, 255);">Pending</h1></main></div></body></html>';
  const queueFileContentSave = vi.fn();
  const updateLiveScreenSnapshotContent = vi.fn(() => true);
  const recordLocalContentHistoryEntry = vi.fn();
  const latestActiveContentRef = ref<string | null>(pendingContent);
  const canApplyContentEdit = vi.fn(() => true);

  const args: CommitVisualStylesArgs = {
    activeBreakpointUpperBoundPx: null,
    activeBreakpointWidthStateRef: ref<number | undefined>(undefined),
    activeCanvasSourceType: "inline",
    activeCodeLayerProjection: buildCodeLayerProjection(activeContent, {
      source: { kind: "design-file", fileId },
    }),
    activeFile: {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content: activeContent,
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
    },
    activeProjectionContent: activeContent,
    canApplyContentEdit,
    canEditDesign: true,
    commitVisualStyles: vi.fn(),
    getScreenContent: () => pendingContent,
    isSynced: false,
    lastDuplicateTransformRef: ref(null),
    lastLocalContentRef: ref<string | null>(activeContent),
    latestActiveContentRef,
    liveScreenSnapshotsById: {
      [fileId]: { url: "about:blank", html: runtimeSnapshot },
    },
    queueFileContentSave,
    recordContentHistoryEntry: vi.fn(),
    recordLocalContentHistoryChangeFallback: vi.fn(),
    recordLocalContentHistoryEntry,
    recordPendingVisualStyleEdit: vi.fn(),
    replacePreviewContent: vi.fn(() => "applied" as const),
    responsiveEditScopeRef: ref("cascade-smaller"),
    selectedElement: null,
    setCollabContent: vi.fn(),
    setCollabContentFileId: vi.fn(),
    setContentRenderRevision: vi.fn(),
    setPatchProof: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    suppressContentHistoryRef: ref(false),
    t: (key: string) => key,
    undoManagerRef: ref(null),
    updateLiveScreenSnapshotContent,
    upsertMotionKeyframesFromStyles: vi.fn(),
    viewModeRef: ref("single"),
    ydoc: null,
  };
  runCommitVisualStyles(args, "#target", {
    color: "transparent",
    backgroundImage: "linear-gradient(90deg, red, blue)",
    backgroundClip: "text",
  });

  expect(queueFileContentSave).toHaveBeenCalledOnce();
  const [savedFileId, savedContent, options] =
    queueFileContentSave.mock.calls[0];
  expect(savedFileId).toBe(fileId);
  expect(savedContent).toContain('data-pending="true"');
  expect(savedContent).toContain("linear-gradient(90deg, red, blue)");
  expect(options.expectedVersionHash).toBe(sourceContentHash(pendingContent));
  expect(options.expectedVersionHash).not.toBe(
    sourceContentHash(runtimeSnapshot),
  );
  expect(latestActiveContentRef.current).toBe(savedContent);
  expect(updateLiveScreenSnapshotContent).not.toHaveBeenCalled();
  expect(recordLocalContentHistoryEntry).toHaveBeenCalledOnce();

  queueFileContentSave.mockClear();
  canApplyContentEdit.mockReturnValue(false);
  runCommitVisualStyles(args, "#target", { color: "green" });
  expect(queueFileContentSave).not.toHaveBeenCalled();
  expect(latestActiveContentRef.current).toBe(savedContent);
});
