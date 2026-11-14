import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { expect, it, vi } from "vitest";

import {
  elementInfoFromCodeLayerNode,
  type SelectedLayerTarget,
} from "@/pages/design-editor/code-layer-state";
import type { DesignFile } from "@/pages/design-editor/types";

import { runCommitRelativeStyleDeltaToSelectedLayers } from "./commit-relative-style-delta-to-selected-layers";

it("lands a relative X/W edit of sub-pixel layers on whole pixels", () => {
  const content = `<div data-agent-native-node-id="first" style="position: absolute; left: 256.96px; width: 120.4px; letter-spacing: 0.25px">A</div><div data-agent-native-node-id="second" style="position: absolute; left: 40.5px; width: 80px; letter-spacing: 0.25px">B</div>`;
  const source = { kind: "design-file" as const, fileId: "screen" };
  const projection = buildCodeLayerProjection(content, { source });
  const tree = buildCodeLayerTree(projection);
  const selectedLayerTargets = ["first", "second"].map((id) => {
    const node = projection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === id,
    )!;
    return {
      layerId: node.id,
      fileId: "screen",
      node,
      tree,
      elementInfo: elementInfoFromCodeLayerNode(node),
    } satisfies SelectedLayerTarget;
  });
  const applyFileContentUpdate = vi.fn((_fileId: string, next: string) => ({
    status: "accepted" as const,
    content: next,
    nodeIdMap: new Map(
      buildCodeLayerProjection(next, { source }).nodes.map((node) => [
        node.id,
        node.id,
      ]),
    ),
  }));
  const activeFile: DesignFile = {
    id: "screen",
    filename: "screen.html",
    fileType: "html",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const args = {
    activeBreakpointUpperBoundPx: null,
    activeBreakpointWidthStateRef: { current: undefined },
    activeCanvasSourceType: "inline" as const,
    activeContent: content,
    activeFile,
    applyFileContentUpdate,
    canEditDesign: true,
    effectiveCodeLayerStateRef: {
      current: { lockedIds: new Set<string>(), hiddenIds: new Set<string>() },
    },
    getScreenContent: () => content,
    lastLocalContentRef: { current: null },
    latestActiveContentRef: { current: null },
    responsiveEditScopeRef: { current: "cascade-smaller" as const },
    selectedLayerTargetsRef: { current: selectedLayerTargets },
    setSelectedElement: vi.fn(),
  };

  expect(
    runCommitRelativeStyleDeltaToSelectedLayers(
      args,
      ["left", "width", "letterSpacing"],
      10,
    ),
  ).toBe(true);

  expect(applyFileContentUpdate).toHaveBeenCalledOnce();
  const saved = applyFileContentUpdate.mock.calls[0]![1];
  expect(saved).toMatch(/left:\s*267px/);
  expect(saved).toMatch(/width:\s*130px/);
  expect(saved).toMatch(/left:\s*51px/);
  expect(saved).toMatch(/width:\s*90px/);
  expect(saved).toMatch(/letter-spacing:\s*10\.25px/);
});
