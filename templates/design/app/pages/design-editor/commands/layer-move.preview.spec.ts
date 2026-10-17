// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { runLayerMove } from "./layer-move";

const fileId = "screen-1";
const content = `<!doctype html><html><body data-agent-native-node-id="root"><div data-agent-native-node-id="row"><div data-agent-native-node-id="card-a">A</div><div data-agent-native-node-id="card-b">B</div></div></body></html>`;
const source = { kind: "design-file" as const, fileId };
const projection = buildCodeLayerProjection(content, { source });
const tree = buildCodeLayerTree(projection);
const nodeByAttributeId = new Map(
  projection.nodes.map((node) => [
    node.dataAttributes["data-agent-native-node-id"],
    node,
  ]),
);
const cardA = nodeByAttributeId.get("card-a")!;
const cardB = nodeByAttributeId.get("card-b")!;

function run(duplicate: boolean) {
  const writes: Array<{
    content: string;
    options?: { forcePreviewFullDocument?: boolean };
  }> = [];
  let selectedLayerIds: string[] = [];
  const owners = new Map(
    projection.nodes.map((node) => [
      node.id,
      { fileId, node, sourceProjection: projection, tree, runtimeOnly: false },
    ]),
  );
  runLayerMove(
    {
      activeFile: { id: fileId, content } as never,
      applyFileContentUpdate: (id, nextContent, options) => {
        const prepared = prepareCanonicalSourceContent(nextContent, {
          fileId: id,
          fileType: "html",
        });
        writes.push({ content: prepared.content, options });
        return {
          status: "accepted" as const,
          content: prepared.content,
          nodeIdMap: prepared.nodeIdMap,
        };
      },
      canEditDesign: true,
      canMoveLayer: () => true,
      codeLayerOwnerByNodeId: owners,
      effectiveCodeLayerState: { lockedIds: new Set() } as never,
      files: [{ id: fileId, content }] as never,
      getFreshActiveContent: () => content,
      getScreenContent: () => content,
      handleLayerMoveToScreen: () => {},
      handleScreenLayerMove: () => {},
      recordContentHistoryEntry: () => {},
      recordLocalContentHistoryEntry: () => {},
      remapMotionTracksForClone: () => {},
      runtimeStructureMoveRevisionRef: { current: 0 },
      sendRuntimeLayerMoveSemanticHandoff: () => false,
      setExpandedLayerIds: () => {},
      setRuntimeStructureMoveRequest: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: (value) => {
        selectedLayerIds =
          typeof value === "function" ? value(selectedLayerIds) : value;
      },
      t: (key) => key,
      viewModeRef: { current: "overview" },
      visualScreenFileIds: new Set(),
    },
    {
      draggedIds: [cardA.id],
      targetId: cardB.id,
      placement: "after",
      duplicate,
    } as never,
  );
  expect(writes).toHaveLength(1);
  return { selectedLayerIds, write: writes[0]! };
}

describe("layer move preview scope", () => {
  it("repaints the parent after reordering siblings", () => {
    expect(run(false).write.options).toMatchObject({
      forcePreviewFullDocument: true,
    });
  });

  it("repaints the parent after duplicate-at-drop inserts a sibling", () => {
    const result = run(true);
    expect(result.write.options).toMatchObject({
      forcePreviewFullDocument: true,
    });
    const ownedProjection = buildCodeLayerProjection(result.write.content, {
      source,
    });
    expect(result.selectedLayerIds).toHaveLength(1);
    expect(
      ownedProjection.nodes.some(
        (node) => node.id === result.selectedLayerIds[0],
      ),
    ).toBe(true);
  });
});
