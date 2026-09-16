// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import type { GeometryHistorySelection } from "@/pages/design-editor/history";

import { runScreenVisualDuplicateChange } from "./screen-visual-duplicate-change";

describe("runScreenVisualDuplicateChange linked main structure", () => {
  it("dispatches an inactive-screen interior clone without a local write", () => {
    const activeFile = {
      id: "active-file",
      filename: "active.html",
      fileType: "html",
      content: "<body></body>",
      createdAt: "",
      updatedAt: "",
    } as const;
    const screenId = "inactive-file";
    const source = {
      kind: "design-file" as const,
      designId: "design-1",
      fileId: screenId,
      filename: "inactive.html",
    };
    const content = `<!doctype html>\n<html><head><!--keep--></head><body><main data-agent-native-node-id="main" data-agent-native-component-id="cmp-card"><span data-agent-native-node-id="label">Label</span><span data-agent-native-node-id="anchor">Anchor</span></main></body></html>`;
    const projection = buildCodeLayerProjection(content, { source });
    const label = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "label",
    );
    expect(label).toBeDefined();
    if (!label) return;
    const elementInfo: ElementInfo = {
      tagName: "SPAN",
      sourceId: "label",
      selector: '[data-agent-native-node-id="label"]',
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 40, height: 20 },
      isFlexChild: false,
      isFlexContainer: false,
    };
    const selectionBefore: GeometryHistorySelection = {
      activeFileId: "active-file",
      overviewSelectedScreenIds: [screenId],
      selectedLayerIds: [label.id, "unrelated-selection"],
      sourceContentByFileId: {},
      sourceFileIdByFileId: {},
    };
    const applyLinkedComponentEdit = vi.fn();
    const applyFileContentUpdate = vi.fn();
    const remapMotionTracksForClone = vi.fn();

    const result = runScreenVisualDuplicateChange(
      {
        activeFile,
        applyLinkedComponentEdit,
        applyFileContentUpdate,
        canEditDesign: true,
        componentLinksForFile: () => ({
          sourceFileIds: [screenId],
          targetSource: source,
          documents: [{ source, content }],
        }),
        getScreenContent: () => content,
        handleVisualDuplicateChange: () => {
          throw new Error("inactive screen should use its own linked path");
        },
        remapMotionTracksForClone,
        selectionBefore,
        t: (key: string) => key,
      },
      screenId,
      '[data-agent-native-node-id="label"]',
      '<span data-agent-native-node-id="new-label">New</span>',
      elementInfo,
      {
        sourceId: "label",
        anchorSelector: '[data-agent-native-node-id="anchor"]',
        anchorSourceId: "anchor",
        placement: "after",
      },
    );

    expect(result).toBe(true);
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
    const [fileId, nodeId, edit, receivedSelection, onApplied] =
      applyLinkedComponentEdit.mock.calls[0]!;
    expect(fileId).toBe(screenId);
    expect(nodeId).toBe("main");
    expect(edit).toMatchObject({ kind: "structure", before: content });
    expect(edit.after).toContain("New");
    expect(edit.selectionNodeIds).toHaveLength(1);
    expect(receivedSelection.activeFileId).toBe(screenId);
    expect(receivedSelection.selectedLayerIds).toEqual([label.id]);
    expect(receivedSelection.sourceContentByFileId?.[screenId]).toBe(content);
    expect(onApplied).toEqual(expect.any(Function));
    expect(remapMotionTracksForClone).not.toHaveBeenCalled();

    onApplied();
    expect(remapMotionTracksForClone).toHaveBeenCalledWith(
      expect.any(Map),
      screenId,
    );
  });
});
