// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { analyzeComponentLinks } from "@shared/component-links";
import { COMPONENT_REF_ATTR } from "@shared/component-model";
import { describe, expect, it } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runDuplicateSelection } from "./duplicate-selection";

describe("runDuplicateSelection component links", () => {
  it("turns a same-Design duplicate of a main into a linked reference", () => {
    const designId = "design-1";
    const fileId = "screen-1";
    const source = {
      kind: "design-file" as const,
      designId,
      fileId,
      filename: "index.html",
    };
    const content = `<!doctype html><html><body>
      <button data-agent-native-node-id="button-main" data-agent-native-component-id="cmp-button" data-agent-native-component="Button">Save</button>
    </body></html>`;
    const projection = buildCodeLayerProjection(content, { source });
    const node = projection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "button-main",
    );
    expect(node?.source).toBeTruthy();
    if (!node?.source) return;

    const snapshot = {
      html: content.slice(node.source.start, node.source.end),
      rootNodeId: "button-main",
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
      selectedLayerIdsState: [node.id],
      setOverviewSelectedScreenIds: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      t: (key) => key,
      undoManagerRef: { current: null },
      viewModeRef: { current: "overview" },
    });

    const after = buildCodeLayerProjection(currentContent, { source });
    const references = after.nodes.filter(
      (candidate) =>
        candidate.dataAttributes[COMPONENT_REF_ATTR] === "cmp-button",
    );
    expect(references).toHaveLength(1);
    expect(references[0]?.dataAttributes["data-agent-native-node-id"]).not.toBe(
      "button-main",
    );
    expect(
      analyzeComponentLinks([after]).components.find(
        (component) => component.componentId === "cmp-button",
      )?.status,
    ).toBe("resolved");
  });
});
