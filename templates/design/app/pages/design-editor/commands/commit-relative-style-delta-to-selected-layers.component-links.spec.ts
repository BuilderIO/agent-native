import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "@shared/component-model";
import { describe, expect, it, vi } from "vitest";

import {
  elementInfoFromCodeLayerNode,
  type SelectedLayerTarget,
} from "@/pages/design-editor/code-layer-state";
import type { DesignFile } from "@/pages/design-editor/types";

import { runCommitRelativeStyleDeltaToSelectedLayers } from "./commit-relative-style-delta-to-selected-layers";

function targetsFor(content: string, fileId: string, ids: string[]) {
  const source = { kind: "design-file" as const, fileId };
  const projection = buildCodeLayerProjection(content, { source });
  const tree = buildCodeLayerTree(projection);
  return ids.map((id) => {
    const node = projection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === id,
    );
    if (!node) throw new Error(`Missing fixture target ${id}`);
    return {
      layerId: node.id,
      fileId,
      node,
      tree,
      elementInfo: elementInfoFromCodeLayerNode(node),
    } satisfies SelectedLayerTarget;
  });
}

it("routes relative multi-target values through one linked batch", () => {
  const main = `<section data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="card"><div data-agent-native-node-id="linked-child" style="width: 100px; margin-left: 8px; margin-right: 12px">Linked</div></section><div data-agent-native-node-id="plain-child" style="width: 200px; margin-left: 20px; margin-right: 30px">Plain</div>`;
  const copy = `<section data-agent-native-node-id="copy-root" ${COMPONENT_REF_ATTR}="card"><div data-agent-native-node-id="copy-child" ${COMPONENT_SOURCE_NODE_ID_ATTR}="linked-child" style="width: 100px; margin-left: 8px; margin-right: 12px">Linked</div></section>`;
  const selectedLayerTargets = [
    ...targetsFor(main, "main-file", ["linked-child", "plain-child"]),
    ...targetsFor(copy, "copy-file", ["copy-child"]),
  ];
  const files: Record<string, string> = {
    "main-file": main,
    "copy-file": copy,
  };
  const applyLinkedComponentEdit = vi.fn();
  const applyFileContentUpdate = vi.fn((fileId: string, content: string) => ({
    status: "accepted" as const,
    content,
    nodeIdMap: new Map([[fileId, fileId]]),
  }));
  const activeFile: DesignFile = {
    id: "main-file",
    filename: "main.html",
    fileType: "html",
    content: main,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const applied = runCommitRelativeStyleDeltaToSelectedLayers(
    {
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthStateRef: { current: undefined },
      activeCanvasSourceType: "inline",
      activeContent: main,
      activeFile,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      canEditDesign: true,
      effectiveCodeLayerStateRef: {
        current: { lockedIds: new Set(), hiddenIds: new Set() },
      },
      getScreenContent: (fileId) => files[fileId] ?? "",
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      responsiveEditScopeRef: { current: "cascade-smaller" },
      selectedLayerTargetsRef: { current: selectedLayerTargets },
      setSelectedElement: vi.fn(),
    },
    ["width", "marginLeft", "marginRight"],
    10,
  );

  expect(applied).toBe(true);
  expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
  expect(applyLinkedComponentEdit).toHaveBeenCalledWith(
    "main-file",
    "linked-child",
    {
      kind: "styleTargetsBatch",
      targets: [
        {
          fileId: "main-file",
          nodeId: "linked-child",
          styles: {
            width: "110px",
            marginLeft: "18px",
            marginRight: "22px",
          },
        },
        {
          fileId: "main-file",
          nodeId: "plain-child",
          styles: {
            width: "210px",
            marginLeft: "30px",
            marginRight: "40px",
          },
        },
        {
          fileId: "copy-file",
          nodeId: "copy-child",
          styles: {
            width: "110px",
            marginLeft: "18px",
            marginRight: "22px",
          },
        },
      ],
    },
  );
  expect(applyFileContentUpdate).not.toHaveBeenCalled();
});

it("hands linked localhost relative targets to the live source route", () => {
  const source = `<section data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="card"><div data-agent-native-node-id="linked-child" style="width: 100px">Linked</div></section><div data-agent-native-node-id="plain-child" style="width: 200px">Plain</div><section data-agent-native-node-id="copy-root" ${COMPONENT_REF_ATTR}="card"><div data-agent-native-node-id="copy-child" ${COMPONENT_SOURCE_NODE_ID_ATTR}="linked-child" style="width: 100px">Linked</div></section>`;
  const selectedLayerTargets = targetsFor(source, "live-file", [
    "plain-child",
    "copy-child",
  ]);
  const applyLinkedComponentEdit = vi.fn();
  const commitVisualStyles = vi.fn();
  const reportLinkedEditUnavailable = vi.fn();
  const applyFileContentUpdate = vi.fn();
  const activeFile: DesignFile = {
    id: "live-file",
    filename: "live.html",
    fileType: "html",
    content: source,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const applied = runCommitRelativeStyleDeltaToSelectedLayers(
    {
      activeCanvasSourceType: "localhost",
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthStateRef: { current: undefined },
      activeContent: source,
      activeFile,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      commitVisualStyles,
      canEditDesign: true,
      effectiveCodeLayerStateRef: {
        current: { lockedIds: new Set(), hiddenIds: new Set() },
      },
      getScreenContent: (fileId) => (fileId === "live-file" ? source : ""),
      getProjectionContentForScreen: (fileId) =>
        fileId === "live-file" ? source : "",
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      responsiveEditScopeRef: { current: "cascade-smaller" },
      selectedLayerTargetsRef: { current: selectedLayerTargets },
      reportLinkedEditUnavailable,
      setSelectedElement: vi.fn(),
    },
    "width",
    10,
    "relative-gesture-1",
  );

  expect(applied).toBe(true);
  expect(applyLinkedComponentEdit).not.toHaveBeenCalled();
  expect(applyFileContentUpdate).not.toHaveBeenCalled();
  expect(reportLinkedEditUnavailable).not.toHaveBeenCalled();
  expect(commitVisualStyles).toHaveBeenCalledTimes(2);
  expect(commitVisualStyles.mock.calls.map(([, styles]) => styles)).toEqual([
    { width: "210px" },
    { width: "110px" },
  ]);
  expect(
    commitVisualStyles.mock.calls.map(([, , options]) => [
      options?.pendingUndoGestureId,
      options?.preserveSelection,
    ]),
  ).toEqual([
    ["relative-gesture-1", true],
    ["relative-gesture-1", true],
  ]);
});

it("reports lower-bound-only linked relative edits as one refused batch", () => {
  const main = `<section data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="card"><div data-agent-native-node-id="linked-child" style="width: 100px">Linked</div></section><div data-agent-native-node-id="plain-child" style="width: 200px">Plain</div>`;
  const copy = `<section data-agent-native-node-id="copy-root" ${COMPONENT_REF_ATTR}="card"><div data-agent-native-node-id="copy-child" ${COMPONENT_SOURCE_NODE_ID_ATTR}="linked-child" style="width: 100px">Linked</div></section>`;
  const selectedLayerTargets = [
    ...targetsFor(main, "main-file", ["plain-child"]),
    ...targetsFor(copy, "copy-file", ["copy-child"]),
  ];
  const applyLinkedComponentEdit = vi.fn();
  const reportLinkedEditUnavailable = vi.fn();
  const commitVisualStyles = vi.fn();
  const activeFile: DesignFile = {
    id: "main-file",
    filename: "main.html",
    fileType: "html",
    content: main,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const applied = runCommitRelativeStyleDeltaToSelectedLayers(
    {
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthStateRef: { current: 1280 },
      activeContent: main,
      activeFile,
      applyFileContentUpdate: vi.fn(),
      applyLinkedComponentEdit,
      commitVisualStyles,
      canEditDesign: true,
      effectiveCodeLayerStateRef: {
        current: { lockedIds: new Set(), hiddenIds: new Set() },
      },
      getScreenContent: (fileId) => (fileId === "main-file" ? main : copy),
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      responsiveEditScopeRef: { current: "only" },
      selectedLayerTargetsRef: { current: selectedLayerTargets },
      reportLinkedEditUnavailable,
      setSelectedElement: vi.fn(),
    },
    "width",
    10,
  );

  expect(applied).toBe(true);
  expect(reportLinkedEditUnavailable).toHaveBeenCalledOnce();
  expect(reportLinkedEditUnavailable).toHaveBeenCalledWith("scope");
  expect(applyLinkedComponentEdit).not.toHaveBeenCalled();
  expect(commitVisualStyles).not.toHaveBeenCalled();
});

it("applies a relative margin delta to every changed side on each selected layer", () => {
  const content = `<div data-agent-native-node-id="first" style="margin-left: 8px; margin-right: 12px"></div><div data-agent-native-node-id="second" style="margin-left: 20px; margin-right: 30px"></div>`;
  const files: Record<string, string> = { "main-file": content };
  const selectedLayerTargets = targetsFor(content, "main-file", [
    "first",
    "second",
  ]);
  const applyFileContentUpdate = vi.fn(
    (fileId: string, nextContent: string) => {
      files[fileId] = nextContent;
      return {
        status: "accepted" as const,
        content: nextContent,
        nodeIdMap: new Map(
          buildCodeLayerProjection(nextContent, {
            source: { kind: "design-file", fileId },
          }).nodes.map((node) => [node.id, node.id]),
        ),
      };
    },
  );
  const activeFile: DesignFile = {
    id: "main-file",
    filename: "main.html",
    fileType: "html",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const applied = runCommitRelativeStyleDeltaToSelectedLayers(
    {
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthStateRef: { current: undefined },
      activeContent: content,
      activeFile,
      applyFileContentUpdate,
      canEditDesign: true,
      effectiveCodeLayerStateRef: {
        current: { lockedIds: new Set(), hiddenIds: new Set() },
      },
      getScreenContent: (fileId) => files[fileId] ?? "",
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      responsiveEditScopeRef: { current: "cascade-smaller" },
      selectedLayerTargetsRef: { current: selectedLayerTargets },
      setSelectedElement: vi.fn(),
    },
    ["marginLeft", "marginRight"],
    1,
  );

  expect(applied).toBe(true);
  expect(applyFileContentUpdate).toHaveBeenCalledOnce();
  const updatedProjection = buildCodeLayerProjection(files["main-file"]!, {
    source: { kind: "design-file", fileId: "main-file" },
  });
  const stylesFor = (id: string) => {
    const node = updatedProjection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === id,
    );
    if (!node) throw new Error(`Missing updated target ${id}`);
    return elementInfoFromCodeLayerNode(node).computedStyles;
  };

  expect(stylesFor("first")).toMatchObject({
    marginLeft: "9px",
    marginRight: "13px",
  });
  expect(stylesFor("second")).toMatchObject({
    marginLeft: "21px",
    marginRight: "31px",
  });
});
