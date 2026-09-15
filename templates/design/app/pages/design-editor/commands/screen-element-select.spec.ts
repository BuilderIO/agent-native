import { buildCodeLayerProjection } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import type { ApplyLocalContentUpdateArgs } from "@/pages/design-editor/commands/apply-local-content-update";
import type { DesignFile } from "@/pages/design-editor/types";

import { runApplyLocalContentUpdate } from "./apply-local-content-update";
import { runScreenElementSelect } from "./screen-element-select";

const HTML = `<!doctype html><html data-agent-native-node-id="html-a"><body data-agent-native-node-id="body-a"><main><button class="target" data-agent-native-node-id="button-a">Target</button><span data-agent-native-node-id="sibling-a">Sibling</span></main></body></html>`;
const SCREEN_ID = "screen-a";
const OTHER_SCREEN_ID = "screen-b";

function bridgeInfo(
  target: { id: string; tag: string },
  overrides: Partial<ElementInfo> = {},
): ElementInfo {
  const sourceId = target.id;
  const tagName = target.tag;
  return {
    tagName,
    sourceId,
    selector: `[data-agent-native-node-id="${sourceId}"]`,
    classes: tagName === "button" ? ["target"] : [],
    computedStyles: { backgroundColor: "rgb(15, 118, 110)" },
    inlineStyles: {},
    portableStyleSnapshot: {
      version: 1,
      rootSourceId: sourceId,
      nodes: [
        {
          sourceId,
          path: [],
          styles: { backgroundColor: "rgb(15, 118, 110)" },
        },
      ],
    },
    boundingRect: { x: 10, y: 20, width: 100, height: 32 },
    isFlexChild: false,
    isFlexContainer: false,
    ...overrides,
  };
}

function harness(args: {
  pendingLayerId?: string;
  pendingTarget?: "button" | "body" | "sibling";
  pendingScreenId: string | null;
  createdOverviewLayerSelection?: { screenId: string; layerId: string } | null;
  selectedLayerIds?: string[];
  blocked?: boolean;
}) {
  const projection = buildCodeLayerProjection(HTML, {
    source: { kind: "design-file", fileId: SCREEN_ID },
  });
  const otherProjection = buildCodeLayerProjection(
    HTML.replace('class="target"', 'class="other"'),
    { source: { kind: "design-file", fileId: OTHER_SCREEN_ID } },
  );
  const node = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === "button-a",
  )!;
  const body = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === "body-a",
  )!;
  const sibling = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === "sibling-a",
  )!;
  const pendingNode =
    args.pendingTarget === "body"
      ? body
      : args.pendingTarget === "sibling"
        ? sibling
        : node;
  const setSelectedElement = vi.fn();
  const setSelectedLayerIdsState = vi.fn();
  const clearPendingOverviewLayerSelectionTimer = vi.fn();
  const pendingOverviewLayerSelectionRef = {
    current: args.pendingLayerId ?? pendingNode.id,
  };
  const pendingOverviewScreenSelectionRef = { current: args.pendingScreenId };
  const commandArgs = {
    activeBreakpointWidthStateRef: { current: undefined },
    applyFileContentUpdate: vi.fn(),
    clearPendingOverviewLayerSelectionTimer,
    createdOverviewLayerSelection: args.createdOverviewLayerSelection ?? null,
    focusDesignInspectorForSelection: vi.fn(),
    getCodeLayerProjectionForScreen: (screenId: string) =>
      screenId === SCREEN_ID
        ? projection
        : screenId === OTHER_SCREEN_ID
          ? otherProjection
          : null,
    getScreenContent: () => HTML,
    handleBreakpointBarSelect: vi.fn(),
    id: "design-a",
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    selectedLayerIdsState: args.selectedLayerIds ?? [node.id],
    setActiveFileId: vi.fn(),
    setActiveTool: vi.fn(),
    setCreatedOverviewLayerSelection: vi.fn(),
    setHoveredElement: vi.fn(),
    setHoveredElementScreenId: vi.fn(),
    setMode: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setSelectedElement,
    setSelectedLayerIdsState,
    shouldPreserveBlockedOverviewLayerSelectionRef: {
      current: () => args.blocked ?? false,
    },
    t: (key: string) => key,
    viewModeRef: { current: "overview" as const },
  };
  return {
    body,
    commandArgs,
    clearPendingOverviewLayerSelectionTimer,
    node,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    setSelectedElement,
    setSelectedLayerIdsState,
    sibling,
  };
}

describe("canvas modifier selection", () => {
  it.each([
    ["Cmd", { metaKey: true, ctrlKey: false }],
    ["Ctrl", { metaKey: false, ctrlKey: true }],
  ] as const)(
    "deep %s click replaces the previous layer selection",
    (_name, modifiers) => {
      const setup = harness({
        pendingLayerId: "unrelated-pending-layer",
        pendingScreenId: null,
      });

      runScreenElementSelect(
        setup.commandArgs,
        SCREEN_ID,
        bridgeInfo({ id: "sibling-a", tag: "span" }),
        {
          additive: false,
          range: false,
          source: "pointer",
          shiftKey: false,
          ...modifiers,
        },
      );

      const update = setup.setSelectedLayerIdsState.mock.calls[0]?.[0];
      expect(typeof update).toBe("function");
      if (typeof update !== "function")
        throw new Error("selection updater missing");
      expect(update([setup.node.id])).toEqual([setup.sibling.id]);
    },
  );

  it("adds Shift+Cmd deep selection and preserves intent-less re-anchoring", () => {
    const added = harness({
      pendingLayerId: "unrelated-pending-layer",
      pendingScreenId: null,
      selectedLayerIds: [],
    });

    runScreenElementSelect(
      added.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "sibling-a", tag: "span" }),
      {
        additive: true,
        range: true,
        source: "pointer",
        shiftKey: true,
        metaKey: true,
      },
    );
    const addUpdate = added.setSelectedLayerIdsState.mock.calls[0]?.[0];
    expect(typeof addUpdate).toBe("function");
    if (typeof addUpdate !== "function")
      throw new Error("selection updater missing");
    expect(addUpdate([added.node.id])).toEqual([
      added.node.id,
      added.sibling.id,
    ]);

    const echoed = harness({
      pendingLayerId: "unrelated-pending-layer",
      pendingScreenId: null,
      selectedLayerIds: [added.node.id, added.sibling.id],
    });
    runScreenElementSelect(
      echoed.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
    );
    const echoUpdate = echoed.setSelectedLayerIdsState.mock.calls[0]?.[0];
    expect(typeof echoUpdate).toBe("function");
    if (typeof echoUpdate !== "function")
      throw new Error("selection updater missing");
    expect(echoUpdate([added.node.id, added.sibling.id])).toEqual([
      added.node.id,
      added.sibling.id,
    ]);
  });
});

describe("Layers selection runtime-info echo", () => {
  it("hydrates only the exact pending non-root layer and preserves selection state", () => {
    const setup = harness({
      pendingScreenId: SCREEN_ID,
    });

    runScreenElementSelect(
      setup.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({
        computedStyles: { backgroundColor: "rgb(15, 118, 110)" },
        portableStyleSnapshot: expect.any(Object),
        sourceLayerIdentity: {
          screenId: SCREEN_ID,
          nodeId: setup.node.id,
        },
      }),
    );
    expect(setup.setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(
      setup.clearPendingOverviewLayerSelectionTimer,
    ).not.toHaveBeenCalled();
    expect(setup.pendingOverviewLayerSelectionRef.current).toBe(setup.node.id);
    expect(setup.pendingOverviewScreenSelectionRef.current).toBe(SCREEN_ID);
  });

  it("hydrates a pending node addressed by its durable DOM id", () => {
    const setup = harness({
      pendingLayerId: "button-a",
      pendingScreenId: SCREEN_ID,
    });

    runScreenElementSelect(
      setup.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({
        portableStyleSnapshot: expect.any(Object),
        sourceLayerIdentity: {
          screenId: SCREEN_ID,
          nodeId: setup.node.id,
        },
      }),
    );
    expect(setup.setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(setup.pendingOverviewLayerSelectionRef.current).toBe("button-a");
    expect(setup.pendingOverviewScreenSelectionRef.current).toBe(SCREEN_ID);
  });

  it("hydrates the exact pending node when its complete style snapshot failed", () => {
    const setup = harness({
      pendingLayerId: "button-a",
      pendingScreenId: SCREEN_ID,
    });

    runScreenElementSelect(
      setup.commandArgs,
      SCREEN_ID,
      bridgeInfo(
        { id: "button-a", tag: "button" },
        {
          portableStyleSnapshot: undefined,
          styleSnapshotCaptureFailed: true,
        },
      ),
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({
        portableStyleSnapshot: undefined,
        styleSnapshotCaptureFailed: true,
        sourceLayerIdentity: {
          screenId: SCREEN_ID,
          nodeId: setup.node.id,
        },
      }),
    );
    expect(setup.setSelectedLayerIdsState).not.toHaveBeenCalled();
  });

  it("hydrates an exact projected layer after its Screen owner ref clears", () => {
    const setup = harness({ pendingScreenId: null });

    runScreenElementSelect(
      setup.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({
        portableStyleSnapshot: expect.any(Object),
        sourceLayerIdentity: {
          screenId: SCREEN_ID,
          nodeId: setup.node.id,
        },
      }),
    );
    expect(setup.setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(setup.pendingOverviewLayerSelectionRef.current).toBe(setup.node.id);
    expect(setup.pendingOverviewScreenSelectionRef.current).toBeNull();
  });

  it("uses the created layer owner when the pending Screen ref has cleared", () => {
    const setup = harness({
      pendingLayerId: "button-a",
      pendingScreenId: null,
      createdOverviewLayerSelection: {
        screenId: SCREEN_ID,
        layerId: "button-a",
      },
    });

    runScreenElementSelect(
      setup.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({
        portableStyleSnapshot: expect.any(Object),
        sourceLayerIdentity: {
          screenId: SCREEN_ID,
          nodeId: setup.node.id,
        },
      }),
    );
    expect(setup.setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(setup.pendingOverviewLayerSelectionRef.current).toBe("button-a");
    expect(setup.pendingOverviewScreenSelectionRef.current).toBeNull();
  });

  it("does not hydrate through a fallback whose layer does not match", () => {
    const setup = harness({
      pendingLayerId: "button-a",
      pendingScreenId: null,
      createdOverviewLayerSelection: {
        screenId: SCREEN_ID,
        layerId: "sibling-a",
      },
    });

    runScreenElementSelect(
      setup.commandArgs,
      SCREEN_ID,
      bridgeInfo(
        { id: "button-a", tag: "button" },
        { portableStyleSnapshot: undefined },
      ),
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({ portableStyleSnapshot: undefined }),
    );
    expect(setup.setSelectedLayerIdsState).toHaveBeenCalled();
    expect(setup.pendingOverviewLayerSelectionRef.current).toBeNull();
    expect(setup.pendingOverviewScreenSelectionRef.current).toBeNull();
  });

  it("processes a pointer selection from another Screen with a duplicate ID", () => {
    const setup = harness({
      pendingLayerId: "button-a",
      pendingScreenId: null,
      createdOverviewLayerSelection: {
        screenId: SCREEN_ID,
        layerId: "button-a",
      },
    });

    runScreenElementSelect(
      setup.commandArgs,
      OTHER_SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
      { source: "pointer" },
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "button-a" }),
    );
    expect(setup.setSelectedLayerIdsState).toHaveBeenCalled();
    expect(setup.commandArgs.setActiveFileId).toHaveBeenCalledWith(
      OTHER_SCREEN_ID,
    );
    expect(setup.pendingOverviewLayerSelectionRef.current).toBeNull();
    expect(setup.pendingOverviewScreenSelectionRef.current).toBeNull();
  });

  it("does not treat an ownerless authored-ID match on another Screen as an echo", () => {
    const setup = harness({
      pendingLayerId: "button-a",
      pendingScreenId: null,
    });

    runScreenElementSelect(
      setup.commandArgs,
      OTHER_SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "button-a",
        sourceLayerIdentity: {
          screenId: OTHER_SCREEN_ID,
          nodeId: expect.any(String),
        },
      }),
    );
    expect(setup.setSelectedLayerIdsState).toHaveBeenCalled();
    expect(setup.commandArgs.setActiveFileId).toHaveBeenCalledWith(
      OTHER_SCREEN_ID,
    );
  });

  it("does not treat another node or Screen as the pending creation echo", () => {
    const otherNode = harness({
      pendingLayerId: "button-a",
      pendingScreenId: SCREEN_ID,
    });

    runScreenElementSelect(
      otherNode.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "sibling-a", tag: "span" }),
    );

    expect(otherNode.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "sibling-a" }),
    );
    expect(otherNode.setSelectedLayerIdsState).toHaveBeenCalled();
    expect(otherNode.pendingOverviewLayerSelectionRef.current).toBeNull();
    expect(otherNode.pendingOverviewScreenSelectionRef.current).toBeNull();

    const otherScreen = harness({ pendingScreenId: SCREEN_ID });
    runScreenElementSelect(
      otherScreen.commandArgs,
      OTHER_SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
    );

    expect(otherScreen.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "button-a" }),
    );
    expect(otherScreen.setSelectedLayerIdsState).toHaveBeenCalled();
    expect(otherScreen.commandArgs.setActiveFileId).toHaveBeenCalledWith(
      OTHER_SCREEN_ID,
    );
    expect(otherScreen.pendingOverviewLayerSelectionRef.current).toBeNull();
    expect(otherScreen.pendingOverviewScreenSelectionRef.current).toBeNull();
  });

  it("does not hydrate root, incomplete, or blocked pending selections", () => {
    const root = harness({
      pendingTarget: "body",
      pendingScreenId: SCREEN_ID,
    });
    runScreenElementSelect(
      root.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "body-a", tag: "body" }),
    );
    expect(root.setSelectedElement).not.toHaveBeenCalled();

    const incomplete = harness({
      pendingScreenId: SCREEN_ID,
    });
    runScreenElementSelect(
      incomplete.commandArgs,
      SCREEN_ID,
      bridgeInfo(
        { id: "button-a", tag: "button" },
        {
          portableStyleSnapshot: undefined,
        },
      ),
    );
    expect(incomplete.setSelectedElement).not.toHaveBeenCalled();

    const blocked = harness({
      pendingScreenId: SCREEN_ID,
      blocked: true,
    });
    runScreenElementSelect(
      blocked.commandArgs,
      SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
    );
    expect(blocked.setSelectedElement).not.toHaveBeenCalled();
  });

  it("keeps a real cross-Screen selection with a duplicate authored id", () => {
    const setup = harness({
      pendingScreenId: SCREEN_ID,
    });

    runScreenElementSelect(
      setup.commandArgs,
      OTHER_SCREEN_ID,
      bridgeInfo({ id: "button-a", tag: "button" }),
      { source: "pointer" },
    );

    expect(setup.setSelectedElement).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "button-a" }),
    );
    expect(setup.setSelectedLayerIdsState).toHaveBeenCalled();
    expect(setup.commandArgs.setActiveFileId).toHaveBeenCalledWith(
      OTHER_SCREEN_ID,
    );
  });

  it.each(["pending bridge id", "projection fallback"] as const)(
    "keeps fresh source bytes as the save base when stamping a missing id via %s",
    (stampPath) => {
      const rawContent =
        '<!doctype html><html><body><main><button class="target">Target</button><p class="ai-note">Fresh AI edit</p></main></body></html>';
      const staleCollabContent = rawContent.replace(
        "Fresh AI edit",
        "Older collab text",
      );
      const projection = buildCodeLayerProjection(rawContent, {
        source: { kind: "design-file", fileId: SCREEN_ID },
      });
      const setup = harness({
        pendingLayerId: "unrelated-pending-layer",
        pendingScreenId: null,
      });
      const queueFileContentSave = vi.fn();
      const localUpdateArgs = {
        acknowledgeAuthoritativeClipboardMutation: vi.fn(),
        activeFile: {
          id: SCREEN_ID,
          content: staleCollabContent,
          fileType: "html",
        } as DesignFile,
        canEditDesignRef: { current: true },
        cancelQueuedFileContentSave: vi.fn(),
        clearPendingLocalFileContent: vi.fn(),
        collabContentFileIdRef: { current: SCREEN_ID },
        collabContentRef: { current: staleCollabContent },
        id: "design-a",
        isSynced: false,
        lastLocalContentRef: { current: staleCollabContent },
        latestActiveContentRef: { current: staleCollabContent },
        markPendingLocalFileContent: vi.fn(),
        queryClient: { setQueryData: vi.fn() },
        queueFileContentSave,
        recordContentHistoryEntry: vi.fn(),
        recordLocalContentHistoryChangeFallback: vi.fn(),
        recordLocalContentHistoryEntry: vi.fn(),
        replacePreviewContent: () => "applied" as const,
        setCollabContent: vi.fn(),
        setCollabContentFileId: vi.fn(),
        setContentRenderRevision: vi.fn(),
        suppressContentHistoryRef: { current: false },
        t: (key: string) => key,
        undoManagerRef: { current: null },
        viewModeRef: { current: "overview" as const },
        ydoc: null,
      };

      setup.commandArgs.getCodeLayerProjectionForScreen = (screenId) =>
        stampPath === "pending bridge id"
          ? null
          : screenId === SCREEN_ID
            ? projection
            : null;
      setup.commandArgs.getScreenContent = () => rawContent;
      setup.commandArgs.applyFileContentUpdate.mockImplementation(
        (fileId, nextContent, options) => {
          expect(fileId).toBe(SCREEN_ID);
          return runApplyLocalContentUpdate(
            localUpdateArgs as unknown as ApplyLocalContentUpdateArgs,
            nextContent,
            options,
          );
        },
      );

      const info = bridgeInfo({ id: "target", tag: "button" });
      delete info.sourceId;
      info.selector = ".target";
      if (stampPath === "pending bridge id") {
        info.pendingNodeId = "pending-target-id";
      }

      runScreenElementSelect(setup.commandArgs, SCREEN_ID, info);

      expect(queueFileContentSave).toHaveBeenCalledOnce();
      const [fileId, savedContent, saveOptions] =
        queueFileContentSave.mock.calls[0]!;
      expect(fileId).toBe(SCREEN_ID);
      expect(saveOptions.expectedVersionHash).toBe(
        sourceContentHash(rawContent),
      );
      expect(savedContent).toContain("Fresh AI edit");
      expect(savedContent).not.toContain("Older collab text");
      expect(savedContent).toContain("data-agent-native-node-id");
      if (stampPath === "pending bridge id") {
        expect(savedContent).toContain(
          'data-agent-native-node-id="pending-target-id"',
        );
      } else {
        expect(savedContent).not.toContain("pending-target-id");
      }
    },
  );
});
