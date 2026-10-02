import { buildCodeLayerProjection } from "@shared/code-layer";
import { afterEach, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import {
  runCommitVisualStyles,
  type CommitVisualStylesArgs,
} from "@/pages/design-editor/commands/commit-visual-styles";
import { flushCommitsAfterPaint } from "@/pages/design-editor/commit-after-paint";

const ref = <T>(current: T) => ({ current });
const fileId = "screen-1";
const content =
  '<html><body><h1 id="target" style="color: red">Title</h1></body></html>';

function commitArgs(
  overrides: Partial<CommitVisualStylesArgs> = {},
): CommitVisualStylesArgs {
  return {
    activeBreakpointUpperBoundPx: null,
    activeBreakpointWidthStateRef: ref<number | undefined>(undefined),
    activeCanvasSourceType: "inline",
    activeCodeLayerProjection: buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId },
    }),
    activeFile: {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content,
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z",
    },
    activeProjectionContent: content,
    canApplyContentEdit: () => true,
    canEditDesign: true,
    commitVisualStyles: vi.fn(),
    getScreenContent: () => content,
    isSynced: false,
    lastDuplicateTransformRef: ref(null),
    lastLocalContentRef: ref<string | null>(content),
    latestActiveContentRef: ref<string | null>(content),
    liveScreenSnapshotsById: {},
    onNoRenderedBox: vi.fn(),
    queueFileContentSave: vi.fn(),
    recordContentHistoryEntry: vi.fn(),
    recordLocalContentHistoryChangeFallback: vi.fn(),
    recordLocalContentHistoryEntry: vi.fn(),
    recordPendingVisualStyleEdit: vi.fn(),
    replacePreviewContent: vi.fn(() => "applied" as const),
    responsiveEditScopeRef: ref("cascade-smaller"),
    selectedElement: null,
    selectedElementRef: ref<ElementInfo | null>(null),
    setCollabContent: vi.fn(),
    setCollabContentFileId: vi.fn(),
    setContentRenderRevision: vi.fn(),
    setPatchProof: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    suppressContentHistoryRef: ref(false),
    t: (key: string) => key,
    undoManagerRef: ref(null),
    updateLiveScreenSnapshotContent: vi.fn(() => false),
    upsertMotionKeyframesFromStyles: vi.fn(),
    viewModeRef: ref("single"),
    ydoc: null,
    ...overrides,
  };
}

afterEach(() => {
  flushCommitsAfterPaint();
  vi.unstubAllGlobals();
});

it("shows the runtime style immediately and rewrites the source after paint", () => {
  const sendStyle = vi.fn();
  vi.stubGlobal("window", { __designCanvasSendStyle: sendStyle });
  const args = commitArgs();

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });

  expect(sendStyle).toHaveBeenCalledWith(
    "#target",
    "color",
    "rgb(0, 128, 0)",
    expect.anything(),
  );
  expect(args.queueFileContentSave).not.toHaveBeenCalled();

  flushCommitsAfterPaint();

  expect(args.queueFileContentSave).toHaveBeenCalledOnce();
  expect(vi.mocked(args.queueFileContentSave).mock.calls[0]![1]).toContain(
    "rgb(0, 128, 0)",
  );
  expect(args.setSelectedElement).toHaveBeenCalledOnce();
});

it("leaves a selection made before the commit landed alone", () => {
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const selectedElementRef = ref<ElementInfo | null>(null);
  const args = commitArgs({ selectedElementRef });

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });
  selectedElementRef.current = { selector: "#other" } as ElementInfo;
  flushCommitsAfterPaint();

  expect(args.queueFileContentSave).toHaveBeenCalledOnce();
  expect(args.setSelectedElement).not.toHaveBeenCalled();
  expect(args.setSelectedLayerIdsState).not.toHaveBeenCalled();
});
