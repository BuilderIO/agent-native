// @vitest-environment happy-dom

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import {
  codeLayerSourceNodeIdAttrs,
  isCodeLayerNodeRuntimeOnly,
} from "@/pages/design-editor/code-layer-state";

import {
  absolutePlacePointForDrop,
  runCrossScreenElementDrop,
  shouldAbsolutePlaceOnEmptyScreen,
} from "./cross-screen-element-drop";

const EMPTY_SCREEN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body></body></html>`;

const SCREEN_WITH_FRAME = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1"></div>
</body></html>`;

describe("shouldAbsolutePlaceOnEmptyScreen", () => {
  it("places at the pointer when the destination body has no elements", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: EMPTY_SCREEN,
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(true);
  });

  it("leaves flow-insert alone when the destination already has layers", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: SCREEN_WITH_FRAME,
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(false);
  });

  it("does not treat a live-app URL destination as an empty screen", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: "http://localhost:5173/",
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(false);
  });

  it("requires a pointer", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: EMPTY_SCREEN,
        targetLocalPoint: null,
      }),
    ).toBe(false);
  });
});

describe("absolutePlacePointForDrop", () => {
  it("uses the pointer on an empty screen even when a stale anchor rect is present", () => {
    expect(
      absolutePlacePointForDrop({
        placeAbsoluteOnEmptyScreen: true,
        targetAnchorRect: { left: 180, top: 240 },
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toEqual({ x: 180, y: 240 });
  });

  it("subtracts the anchor origin when placing into a positioned container", () => {
    expect(
      absolutePlacePointForDrop({
        placeAbsoluteOnEmptyScreen: false,
        targetAnchorRect: { left: 100, top: 50 },
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toEqual({ x: 80, y: 190 });
  });
});

describe("runCrossScreenElementDrop duplicate routing", () => {
  it.each(["localhost", "fusion"])(
    "queues an inline Alt-drag copy for a %s screen",
    (sourceType) => {
      const runtimeStructureInsertRevisionRef = { current: 0 };
      let runtimeStructureInsertRequest: unknown = null;

      runCrossScreenElementDrop(
        {
          applyFileContentUpdate: () => {
            throw new Error("live duplicate must not write stored content");
          },
          boardFileId: undefined,
          canEditDesign: true,
          clearPendingOverviewLayerSelectionTimer: () => {},
          codeLayerOwnerByNodeIdRef: { current: new Map() },
          designSourceType: "inline",
          getScreenContent: (screenId) =>
            screenId === "source"
              ? SCREEN_WITH_FRAME
              : "http://localhost:5173/",
          id: undefined,
          overviewScreens: [
            {
              id: "target",
              filename: "target.html",
              content: "http://localhost:5173/",
              updatedAt: "2026-09-11T00:00:00.000Z",
              heightPinned: false,
              sourceType,
            },
          ],
          pendingOverviewLayerSelectionRef: { current: null },
          pendingOverviewScreenSelectionRef: { current: null },
          recordContentHistoryEntry: () => {},
          runtimeStructureInsertRevisionRef,
          sendRuntimeLayerMoveSemanticHandoff: () => {
            throw new Error("duplicate must not use move-only handoff");
          },
          setActiveFileId: () => {},
          setCreatedOverviewLayerSelection: () => {},
          setOverviewSelectedScreenIds: () => {},
          setRuntimeStructureInsertRequest: (value) => {
            runtimeStructureInsertRequest =
              typeof value === "function" ? value(null) : value;
          },
          setSelectedElement: () => {},
          setSelectedLayerIdsState: () => {},
          t: (key) => key,
          viewModeRef: { current: "overview" },
        },
        {
          sourceSelector: "#source",
          sourceNodeId: "source-id",
          sourceScreenId: "source",
          targetScreenId: "target",
          targetAnchorSelector: "body",
          targetAnchorPlacement: "inside",
          targetDropMode: "absolute-container",
          targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
          targetLocalPoint: { x: 240, y: 300 },
          sourcePointerOffset: { x: 10, y: 12 },
          duplicate: true,
          sourceCloneHtml:
            '<section id="source-root" data-agent-native-node-id="copy-id" style="position:absolute;left:4px;top:6px"></section>',
        },
      );

      expect(runtimeStructureInsertRevisionRef.current).toBe(1);
      expect(runtimeStructureInsertRequest).toMatchObject({
        screenId: "target",
        anchor: { selector: "body" },
        placement: "inside",
      });
      const insertedHtml = (runtimeStructureInsertRequest as { html: string })
        .html;
      expect(insertedHtml).not.toContain('id="source-root"');
      expect(insertedHtml).toMatch(/data-agent-native-node-id="[^"]+"/);
      expect(insertedHtml).toContain("left: 130px");
      expect(insertedHtml).toContain("top: 238px");
    },
  );

  it("preserves the grab offset for an inline cross-screen copy", () => {
    const runtimeStructureInsertRevisionRef = { current: 0 };
    let nextDestinationContent = "";

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: (_fileId, nextContent) => {
          nextDestinationContent = nextContent;
        },
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "source" ? SCREEN_WITH_FRAME : SCREEN_WITH_FRAME,
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: SCREEN_WITH_FRAME,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: () => {},
        runtimeStructureInsertRevisionRef,
        sendRuntimeLayerMoveSemanticHandoff: () => true,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: "#source",
        sourceNodeId: "source-id",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorSelector: '[data-agent-native-node-id="frame-1"]',
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        sourcePointerOffset: { x: 10, y: 12 },
        duplicate: true,
        sourceCloneHtml:
          '<section data-agent-native-node-id="copy-id" style="position:absolute;left:4px;top:6px"></section>',
      },
    );

    expect(nextDestinationContent).toContain("left: 130px");
    expect(nextDestinationContent).toContain("top: 238px");
  });

  it("never leaves the dropped copy sharing the still-live source's node id", () => {
    // Regression for B4: an alt-drag duplicate across the screen boundary
    // leaves the ORIGINAL alive in its own file. insertClonedHtmlLayers's
    // preserveIncomingNodeIds only reserved ids already in the destination
    // doc, so the copy silently kept the source's own
    // data-agent-native-node-id — two live elements, two files, one id,
    // which broke every id-keyed lookup on either (including the
    // subsequent Option+Arrow nudge landing on/writing to the wrong file).
    const SOURCE_SCREEN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div id="source-frame" data-agent-native-node-id="source-id" style="position:absolute;left:400px;top:400px;width:60px;height:60px;"></div>
</body></html>`;
    const runtimeStructureInsertRevisionRef = { current: 0 };
    let nextDestinationContent = "";

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: (_fileId, nextContent) => {
          nextDestinationContent = nextContent;
        },
        boardFileId: "board",
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "board" ? SOURCE_SCREEN : SCREEN_WITH_FRAME,
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: SCREEN_WITH_FRAME,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: () => {},
        runtimeStructureInsertRevisionRef,
        sendRuntimeLayerMoveSemanticHandoff: () => true,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: "#source-frame",
        sourceNodeId: "source-id",
        sourceScreenId: "board",
        targetScreenId: "target",
        targetAnchorSelector: '[data-agent-native-node-id="frame-1"]',
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        sourcePointerOffset: { x: 10, y: 12 },
        duplicate: true,
        sourceCloneHtml:
          '<div id="source-frame" data-agent-native-node-id="source-id" style="position:absolute;left:400px;top:400px;width:60px;height:60px;"></div>',
      },
    );

    const projection = buildCodeLayerProjection(nextDestinationContent);
    const copyIds = projection.nodes
      .map((node) => node.dataAttributes["data-agent-native-node-id"])
      .filter((id) => id && id !== "frame-1");
    expect(copyIds).toHaveLength(1);
    expect(copyIds[0]).not.toBe("source-id");
  });

  it("still reserves the still-live source's id when the source is a localhost/fusion screen", () => {
    // A localhost/fusion source's stored content is its route URL, not
    // markup (see getScreenContent) — buildCodeLayerProjection over it finds
    // no ids, so a naive reservation set built only from that projection
    // would be empty and let the duplicate silently keep the id it was
    // stamped with by the live bridge, colliding with the still-running
    // source node. The clone itself must be read for reserved ids too.
    const runtimeStructureInsertRevisionRef = { current: 0 };
    let nextDestinationContent = "";

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: (_fileId, nextContent) => {
          nextDestinationContent = nextContent;
        },
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "source" ? "http://localhost:5173/" : SCREEN_WITH_FRAME,
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: SCREEN_WITH_FRAME,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: () => {},
        runtimeStructureInsertRevisionRef,
        sendRuntimeLayerMoveSemanticHandoff: () => true,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: "#live-node",
        sourceNodeId: "live-node-1",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorSelector: '[data-agent-native-node-id="frame-1"]',
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        duplicate: true,
        sourceCloneHtml:
          '<div id="live-node" data-agent-native-node-id="live-node-1" style="position:absolute;left:20px;top:20px;width:60px;height:60px;"></div>',
      },
    );

    const projection = buildCodeLayerProjection(nextDestinationContent);
    const copyIds = projection.nodes
      .map((node) => node.dataAttributes["data-agent-native-node-id"])
      .filter((id) => id && id !== "frame-1");
    expect(copyIds).toHaveLength(1);
    expect(copyIds[0]).not.toBe("live-node-1");
  });
});

describe("runCrossScreenElementDrop ordinary move routing", () => {
  it("keeps the moved node's authored id — only duplicates need a fresh one", () => {
    // Companion to the "never leaves the dropped copy sharing..." duplicate
    // regression above. An ordinary (non-alt-drag) cross-screen move runs
    // through moveNodeBetweenDocuments, never insertClonedHtmlLayers's
    // clone-id reservation, so it must never remint an id: the node is
    // relocated, not cloned, and its source copy is gone afterward.
    const SOURCE_SCREEN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div id="move-me" data-agent-native-node-id="move-id" style="position:absolute;left:10px;top:10px;width:40px;height:40px;"></div>
</body></html>`;
    const screens: Record<string, string> = {
      source: SOURCE_SCREEN,
      target: SCREEN_WITH_FRAME,
    };
    const applyFileContentUpdate = vi.fn((fileId: string, next: string) => {
      screens[fileId] = next;
    });

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate,
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) => screens[screenId] ?? "",
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: screens.target!,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: () => {},
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff: () => true,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: "#move-me",
        sourceNodeId: "move-id",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetLocalPoint: { x: 240, y: 300 },
      },
    );

    const targetIds = buildCodeLayerProjection(screens.target)
      .nodes.map((node) => node.dataAttributes["data-agent-native-node-id"])
      .filter((id) => id && id !== "frame-1");
    expect(targetIds).toEqual(["move-id"]);
    // The source no longer carries the node at all — it moved, not copied.
    const sourceIds = buildCodeLayerProjection(screens.source).nodes.map(
      (node) => node.dataAttributes["data-agent-native-node-id"],
    );
    expect(sourceIds).not.toContain("move-id");
  });
});

describe("runCrossScreenElementDrop runtime-only routing", () => {
  it("routes a runtime-only id absent from source HTML through the runtime handoff", () => {
    const sourceContent =
      '<html><body><div id="subject">Subject</div></body></html>';
    const runtimeContent =
      '<html><body><div id="subject" data-agent-native-node-id="runtime-1m2vou">Subject</div></body></html>';
    const targetContent =
      '<html><body><div data-agent-native-node-id="an-anchor">Anchor</div></body></html>';
    const runtimeProjection = buildCodeLayerProjection(runtimeContent);
    const runtimeTree = buildCodeLayerTree(runtimeProjection);
    const sourceNodeIdAttrs = codeLayerSourceNodeIdAttrs(sourceContent);
    const sourceNode = runtimeProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "runtime-1m2vou",
    )!;
    const targetProjection = buildCodeLayerProjection(targetContent);
    const targetTree = buildCodeLayerTree(targetProjection);
    const targetNode = targetProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "an-anchor",
    )!;
    const owners = new Map([
      [
        sourceNode.id,
        {
          fileId: "source",
          node: sourceNode,
          tree: runtimeTree,
          runtimeOnly: isCodeLayerNodeRuntimeOnly({
            fileIsRuntimeProjected: false,
            nodeIdAttr: "runtime-1m2vou",
            sourceNodeIdAttrs,
          }),
        },
      ],
      [
        targetNode.id,
        {
          fileId: "target",
          node: targetNode,
          tree: targetTree,
          runtimeOnly: false,
        },
      ],
    ]);
    const applyFileContentUpdate = vi.fn();
    const sendRuntimeLayerMoveSemanticHandoff = vi.fn(() => true);

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate,
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: owners },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "source" ? sourceContent : targetContent,
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: targetContent,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: vi.fn(),
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff,
        setActiveFileId: vi.fn(),
        setCreatedOverviewLayerSelection: vi.fn(),
        setOverviewSelectedScreenIds: vi.fn(),
        setRuntimeStructureInsertRequest: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: '[data-agent-native-node-id="runtime-1m2vou"]',
        sourceNodeId: "runtime-1m2vou",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "an-anchor",
        targetAnchorSelector: '[data-agent-native-node-id="an-anchor"]',
        targetAnchorPlacement: "after",
        targetDropMode: "flow-insert",
      },
    );

    expect(sendRuntimeLayerMoveSemanticHandoff).toHaveBeenCalledWith(
      sourceNode.id,
      targetNode.id,
      "after",
    );
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });
});

describe("runCrossScreenElementDrop — portable style capture failure", () => {
  it("refuses the move: no history entry, no file write for either file, both files' content unchanged, toast shown once", () => {
    // A real (mutable) per-file store, not just call-count mocks — writing
    // TO it is what "applyFileContentUpdate" would mean, so reading it back
    // afterward is a real "the file didn't change" assertion, not an
    // inference from a spy never having been called.
    const screens: Record<string, string> = {
      source: SCREEN_WITH_FRAME,
      target: SCREEN_WITH_FRAME,
    };
    const applyFileContentUpdate = vi.fn((fileId: string, next: string) => {
      screens[fileId] = next;
    });
    const recordContentHistoryEntry = vi.fn();
    const sendRuntimeLayerMoveSemanticHandoff = vi.fn();
    const setRuntimeStructureInsertRequest = vi.fn();
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate,
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) => screens[screenId] ?? "",
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: screens.target!,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry,
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest,
        setSelectedElement,
        setSelectedLayerIdsState,
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: '[data-agent-native-node-id="frame-1"]',
        sourceNodeId: "frame-1",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorSelector: "body",
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        // The capture-failed signal — distinct from `styleSnapshot: undefined`
        // (legitimately nothing to carry), which must keep moving normally;
        // see the "queues an inline Alt-drag copy" tests above for that case.
        styleSnapshotCaptureFailed: true,
      },
    );

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(recordContentHistoryEntry).not.toHaveBeenCalled();
    expect(sendRuntimeLayerMoveSemanticHandoff).not.toHaveBeenCalled();
    expect(setRuntimeStructureInsertRequest).not.toHaveBeenCalled();
    expect(setSelectedElement).not.toHaveBeenCalled();
    expect(setSelectedLayerIdsState).not.toHaveBeenCalled();
    // Read back the store itself — not just "the write function wasn't
    // called" — as the actual "both files unchanged" proof.
    expect(screens.source).toBe(SCREEN_WITH_FRAME);
    expect(screens.target).toBe(SCREEN_WITH_FRAME);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.layerMoveFailed",
      expect.any(Object),
    );
  });
});
