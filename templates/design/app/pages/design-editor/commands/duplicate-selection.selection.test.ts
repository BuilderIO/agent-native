// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runDuplicateSelection } from "./duplicate-selection";

describe("runDuplicateSelection selection tracking", () => {
  it("selects the newly inserted copy, not the pre-duplication original", () => {
    const designId = "design-title";
    const fileId = "screen-title";
    const source = {
      kind: "design-file" as const,
      designId,
      fileId,
      filename: "index.html",
    };
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="title" data-agent-native-layer-name="Project title" style="position:absolute;left:40px;top:40px">Portfolio Project</div>
    </body></html>`;
    const projection = buildCodeLayerProjection(content, { source });
    const node = projection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "title",
    );
    expect(node?.source).toBeTruthy();
    if (!node?.source) return;

    const snapshot = {
      html: content.slice(node.source.start, node.source.end),
      rootNodeId: "title",
      sourceFileId: fileId,
      node,
      sourceIndex: 0,
      tree: buildCodeLayerTree(projection),
    };
    let currentContent = content;
    const file: DesignFile = {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content,
      createdAt: "",
      updatedAt: "",
    };
    const acceptedUpdate = (nextContent: string) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId,
        fileType: "html",
      });
      currentContent = publication.content;
      return {
        status: "accepted" as const,
        content: publication.content,
        nodeIdMap: publication.nodeIdMap,
      };
    };
    const setSelectedLayerIdsState = vi.fn();

    runDuplicateSelection({
      activeFile: file,
      designId,
      applyFileContentUpdate: (_targetFileId, nextContent) =>
        acceptedUpdate(nextContent),
      applyLocalContentUpdate: (nextContent) => acceptedUpdate(nextContent),
      canEditDesign: true,
      files: [file],
      getFreshActiveContent: () => currentContent,
      getScreenContent: () => currentContent,
      getSelectedLayerSnapshots: () => [snapshot],
      handleDuplicateScreen: () => {},
      lastDuplicateTransformRef: { current: null },
      overviewSelectedScreenIds: [fileId],
      remapMotionTracksForClone: () => {},
      selectedCanvasSelector: node.selector,
      selectedElement: null,
      selectedLayerIdsState: ["title"],
      setOverviewSelectedScreenIds: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState,
      t: (key) => key,
      undoManagerRef: { current: null },
      viewModeRef: { current: "single" },
    });

    const after = buildCodeLayerProjection(currentContent, { source });
    const originalNode = after.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "title",
    );
    const copyNode = after.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-layer-name"] ===
          "Project title" && candidate.id !== originalNode?.id,
    );
    expect(copyNode, "duplicate did not produce a second node").toBeTruthy();

    expect(setSelectedLayerIdsState).toHaveBeenCalledWith([copyNode!.id]);
    expect(setSelectedLayerIdsState).not.toHaveBeenCalledWith([
      originalNode!.id,
    ]);
  });
});
