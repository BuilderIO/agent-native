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
  '<html><body><div id="target" data-agent-native-node-id="target" style="position: absolute; left: 10px; top: 10px; width: 100px; height: 40px">Card</div></body></html>';

function commitArgs(): CommitVisualStylesArgs {
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
    activeFileIdRef: ref<string | null>(fileId),
    currentYDocRef: ref(null),
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
  };
}

afterEach(() => {
  flushCommitsAfterPaint();
  vi.unstubAllGlobals();
});

it("persists layer geometry on whole pixels and leaves sub-pixel styling alone", () => {
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const args = commitArgs();

  runCommitVisualStyles(args, "#target", {
    left: "256.96px",
    top: "301.29px",
    width: "333.33px",
    height: "40px",
    borderWidth: "0.5px",
    fontSize: "13.5px",
  });
  flushCommitsAfterPaint();

  expect(args.queueFileContentSave).toHaveBeenCalledOnce();
  const saved = vi.mocked(args.queueFileContentSave).mock.calls[0]![1];
  expect(saved).toMatch(/left:\s*257px/);
  expect(saved).toMatch(/top:\s*301px/);
  expect(saved).toMatch(/width:\s*333px/);
  expect(saved).toMatch(/border-width:\s*0\.5px/);
  expect(saved).toMatch(/font-size:\s*13\.5px/);
  expect(saved).not.toMatch(/256\.96|301\.29|333\.33/);
});

it("corrects a runtime-applied sub-pixel drag preview to the persisted whole-pixel value", () => {
  const sendStyle = vi.fn();
  vi.stubGlobal("window", { __designCanvasSendStyle: sendStyle });
  const args = commitArgs();

  runCommitVisualStyles(
    args,
    "#target",
    { left: "256.96px", top: "301px" },
    { runtimeApplied: true },
  );
  flushCommitsAfterPaint();

  expect(sendStyle).toHaveBeenCalledWith(
    "#target",
    "left",
    "257px",
    expect.anything(),
  );
  expect(sendStyle).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    "256.96px",
    expect.anything(),
  );
});
