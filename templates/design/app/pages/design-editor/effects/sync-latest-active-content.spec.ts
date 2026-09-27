import { buildCodeLayerProjection } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import { afterEach, expect, it, vi } from "vitest";

import { runCommitVisualStyles } from "../commands/commit-visual-styles";
import { syncLatestActiveContentFromRender } from "./sync-latest-active-content";

afterEach(() => vi.unstubAllGlobals());

const ref = <T>(current: T) => ({ current });

it("composes a follow-up padding write from pending source when render content lags", () => {
  vi.stubGlobal("window", {});
  const fileId = "screen-1";
  const activeContent =
    '<html><body><div id="player" style="display:flex;flex-direction:column">player</div></body></html>';
  const latestActiveContentRef = ref<string | null>(activeContent);
  const pendingLocalFileContentsRef = ref(
    new Map<string, { content: string; startedAt: number }>(),
  );
  const queueFileContentSave = vi.fn(
    (
      id: string,
      content: string,
      _options: { expectedVersionHash: string },
    ) => {
      pendingLocalFileContentsRef.current.set(id, {
        content,
        startedAt: Date.now(),
      });
    },
  );
  const args: Parameters<typeof runCommitVisualStyles>[0] = {
    activeBreakpointUpperBoundPx: null,
    activeBreakpointWidthStateRef: ref<number | undefined>(undefined),
    activeCanvasSourceType: "inline" as const,
    activeCodeLayerProjection: buildCodeLayerProjection(activeContent, {
      source: { kind: "design-file" as const, fileId },
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
    canApplyContentEdit: () => true,
    canEditDesign: true,
    commitVisualStyles: vi.fn(),
    getScreenContent: () => latestActiveContentRef.current ?? activeContent,
    isSynced: false,
    lastDuplicateTransformRef: ref(null),
    lastLocalContentRef: ref<string | null>(activeContent),
    latestActiveContentRef,
    liveScreenSnapshotsById: {},
    queueFileContentSave,
    recordContentHistoryEntry: vi.fn(),
    recordLocalContentHistoryChangeFallback: vi.fn(),
    recordLocalContentHistoryEntry: vi.fn(),
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
    updateLiveScreenSnapshotContent: vi.fn(() => false),
    upsertMotionKeyframesFromStyles: vi.fn(),
    viewModeRef: ref("single" as const),
    ydoc: null,
  };

  runCommitVisualStyles(args, "#player", { flexDirection: "row" });
  const horizontalSource = latestActiveContentRef.current;
  expect(horizontalSource).toContain("flex-direction: row");

  syncLatestActiveContentFromRender({
    activeContent,
    activeFile: args.activeFile,
    latestActiveContentRef,
    pendingLocalFileContents: pendingLocalFileContentsRef.current,
  });
  runCommitVisualStyles(args, "#player", {
    paddingLeft: "10px",
    paddingRight: "10px",
  });

  const [, savedContent, saveOptions] =
    queueFileContentSave.mock.calls[1] ?? [];
  expect(savedContent).toContain("flex-direction: row");
  expect(savedContent).toContain("padding-left: 10px");
  expect(savedContent).toContain("padding-right: 10px");
  expect(saveOptions.expectedVersionHash).toBe(
    sourceContentHash(horizontalSource ?? ""),
  );
});

it("uses the rendered source after the per-file pending save is cleared", () => {
  const fileId = "screen-2";
  const previousPending =
    '<html><body><div data-local-edit="true"></div></body></html>';
  const authoritativeContent =
    '<html><body><div data-peer-edit="true"></div></body></html>';
  const latestActiveContentRef = ref<string | null>(previousPending);
  const pendingLocalFileContents = new Map<string, { content: string }>();

  syncLatestActiveContentFromRender({
    activeContent: authoritativeContent,
    activeFile: { id: fileId, fileType: "html" },
    latestActiveContentRef,
    pendingLocalFileContents,
  });

  expect(latestActiveContentRef.current).toContain('data-peer-edit="true"');
  expect(latestActiveContentRef.current).not.toContain(
    'data-local-edit="true"',
  );
});

it("switches to the rendered file and clears the ref when no file is active", () => {
  const latestActiveContentRef = ref<string | null>("stale file A");
  const pendingLocalFileContents = new Map([
    ["file-a", { content: "pending file A" }],
  ]);

  syncLatestActiveContentFromRender({
    activeContent: "rendered file B",
    activeFile: { id: "file-b", fileType: "html" },
    latestActiveContentRef,
    pendingLocalFileContents,
  });
  expect(latestActiveContentRef.current).toContain("rendered file B");
  expect(latestActiveContentRef.current).not.toContain("pending file A");

  syncLatestActiveContentFromRender({
    activeContent: "",
    activeFile: null,
    latestActiveContentRef,
    pendingLocalFileContents,
  });
  expect(latestActiveContentRef.current).toBe("");
});
