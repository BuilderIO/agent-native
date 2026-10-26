// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  type CodeLayerNode,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runDuplicateSelection } from "./duplicate-selection";

const designId = "design-repeat-offset";
const fileId = "screen-repeat-offset";
const source = {
  kind: "design-file" as const,
  designId,
  fileId,
  filename: "index.html",
};

function layerNodes(content: string): CodeLayerNode[] {
  return buildCodeLayerProjection(content, { source }).nodes.filter(
    (node) => node.dataAttributes["data-agent-native-layer-name"] === "Box",
  );
}

function position(node: CodeLayerNode) {
  return { x: parseFloat(node.style.left!), y: parseFloat(node.style.top!) };
}

describe("runDuplicateSelection repeat offset", () => {
  it("repeats the whole move of the duplicate, not the last nudge step", () => {
    let content = `<!doctype html><html><body>
      <div data-agent-native-node-id="box" data-agent-native-layer-name="Box" style="position:absolute;left:40px;top:40px;width:20px;height:20px"></div>
    </body></html>`;
    const file: DesignFile = {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content,
      createdAt: "",
      updatedAt: "",
    };
    const lastDuplicateTransformRef: {
      current: { rootNodeIds: string[]; dx: number; dy: number } | null;
    } = { current: null };
    const accept = (nextContent: string) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId,
        fileType: "html",
      });
      content = publication.content;
      return {
        status: "accepted" as const,
        content: publication.content,
        nodeIdMap: publication.nodeIdMap,
      };
    };
    const duplicate = (node: CodeLayerNode) => {
      const projection = buildCodeLayerProjection(content, { source });
      runDuplicateSelection({
        activeFile: file,
        designId,
        applyFileContentUpdate: (_id, next) => accept(next),
        applyLocalContentUpdate: (next) => accept(next),
        canEditDesign: true,
        files: [file],
        getFreshActiveContent: () => content,
        getScreenContent: () => content,
        getSelectedLayerSnapshots: () => [
          {
            html: content.slice(node.source!.start, node.source!.end),
            rootNodeId:
              node.dataAttributes["data-agent-native-node-id"] ?? node.id,
            sourceFileId: fileId,
            node,
            sourceIndex: 0,
            tree: buildCodeLayerTree(projection),
          },
        ],
        handleDuplicateScreen: () => {},
        lastDuplicateTransformRef,
        overviewSelectedScreenIds: [fileId],
        remapMotionTracksForClone: () => {},
        selectedCanvasSelector: node.selector,
        selectedElement: null,
        selectedLayerIdsState: [node.id],
        setOverviewSelectedScreenIds: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        undoManagerRef: { current: null },
        viewModeRef: { current: "single" },
      });
    };

    duplicate(layerNodes(content)[0]!);
    const copy = layerNodes(content)[1]!;
    expect(position(copy)).toEqual({ x: 40, y: 40 });

    // Three Shift+Right nudges and one Shift+Down; the style commit keeps only
    // the delta of the last nudge in the transform.
    const copyHtml = content.slice(copy.source!.start, copy.source!.end);
    content = content.replace(
      copyHtml,
      copyHtml.replace(/left:\s*40px;\s*top:\s*40px/, "left: 70px; top: 50px"),
    );
    lastDuplicateTransformRef.current = {
      ...lastDuplicateTransformRef.current!,
      dx: 0,
      dy: 10,
    };

    const moved = layerNodes(content)[1]!;
    expect(position(moved)).toEqual({ x: 70, y: 50 });
    duplicate(moved);

    const positions = layerNodes(content).map(position);
    expect(positions).toHaveLength(3);
    expect(positions).toContainEqual({ x: 100, y: 60 });
  });
});
