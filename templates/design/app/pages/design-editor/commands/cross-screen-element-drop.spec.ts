// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
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
