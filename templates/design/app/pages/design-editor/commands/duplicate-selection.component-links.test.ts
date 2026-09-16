// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { analyzeComponentLinks } from "@shared/component-links";
import { COMPONENT_REF_ATTR } from "@shared/component-model";
import { describe, expect, it, vi } from "vitest";

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

  it("dispatches one grouped canonical-main snapshot for multiple interior clones", () => {
    const designId = "design-1";
    const fileId = "main-file";
    const source = {
      kind: "design-file" as const,
      designId,
      fileId,
      filename: "index.html",
    };
    const content = `<!doctype html>\n<html><head><!--keep--></head><body><section data-agent-native-node-id="main" data-agent-native-component-id="cmp-card"><span data-agent-native-node-id="label-a">A</span><span data-agent-native-node-id="label-b">B</span></section></body></html>`;
    const instanceContent = `<section data-agent-native-node-id="instance" data-agent-native-component-ref="cmp-card"><span data-agent-native-node-id="instance-a" data-agent-native-component-source-node-id="label-a">A</span><span data-agent-native-node-id="instance-b" data-agent-native-component-source-node-id="label-b">B</span></section>`;
    const projection = buildCodeLayerProjection(content, { source });
    const nodes = ["label-a", "label-b"].map((durableId) => {
      const node = projection.nodes.find(
        (candidate) =>
          candidate.dataAttributes["data-agent-native-node-id"] === durableId,
      );
      expect(node).toBeDefined();
      if (!node?.source) throw new Error(`Missing ${durableId}`);
      return {
        html: content.slice(node.source.start, node.source.end),
        rootNodeId: durableId,
        sourceFileId: fileId,
        node,
        sourceIndex: durableId === "label-a" ? 0 : 1,
        tree: buildCodeLayerTree(projection),
      };
    });
    const file: DesignFile = {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content,
      createdAt: "",
      updatedAt: "",
    };
    const instanceFile: DesignFile = {
      id: "instance-file",
      filename: "instance.html",
      fileType: "html",
      content: instanceContent,
      createdAt: "",
      updatedAt: "",
    };
    const applyLinkedComponentEdit = vi.fn();
    const applyFileContentUpdate = vi.fn();
    const applyLocalContentUpdate = vi.fn();
    const remapMotionTracksForClone = vi.fn();

    runDuplicateSelection({
      activeFile: file,
      applyLinkedComponentEdit,
      designId,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign: true,
      files: [file, instanceFile],
      getFreshActiveContent: () => content,
      getScreenContent: (id) => (id === fileId ? content : instanceContent),
      getSelectedLayerSnapshots: () => nodes,
      handleDuplicateScreen: () => {},
      lastDuplicateTransformRef: { current: null },
      overviewSelectedScreenIds: [fileId],
      remapMotionTracksForClone,
      selectedCanvasSelector: "",
      selectedElement: null,
      selectedLayerIdsState: nodes.map((snapshot) => snapshot.node.id),
      setOverviewSelectedScreenIds: vi.fn(),
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef: { current: null },
      viewModeRef: { current: "single" },
    });

    expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(remapMotionTracksForClone).not.toHaveBeenCalled();
    const [targetFileId, targetNodeId, edit, _selectionBefore, onApplied] =
      applyLinkedComponentEdit.mock.calls[0]!;
    expect(targetFileId).toBe(fileId);
    expect(targetNodeId).toBe("main");
    expect(edit.kind).toBe("structure");
    expect(edit.before).toBe(content);
    expect(
      edit.after.startsWith(content.slice(0, content.indexOf("<section"))),
    ).toBe(true);
    expect(edit.selectionNodeIds).toHaveLength(2);
    expect(new Set(edit.selectionNodeIds).size).toBe(2);
    expect(edit.selectionNodeIds).not.toEqual(["label-a", "label-b"]);
    expect(onApplied).toEqual(expect.any(Function));

    onApplied();
    expect(remapMotionTracksForClone).toHaveBeenCalledOnce();
    expect(remapMotionTracksForClone).toHaveBeenCalledWith(
      expect.any(Map),
      fileId,
    );
  });
});
