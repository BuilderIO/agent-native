// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { GeometryHistorySelection } from "@/pages/design-editor/history";

import { runVisualDuplicateChange } from "./visual-duplicate-change";

describe("runVisualDuplicateChange linked main structure", () => {
  it("dispatches one exact main snapshot and defers motion remapping", () => {
    const file = {
      id: "main-file",
      filename: "index.html",
      fileType: "html",
      content: "",
      createdAt: "",
      updatedAt: "",
    } as const;
    const source = {
      kind: "design-file" as const,
      designId: "design-1",
      fileId: file.id,
      filename: file.filename,
    };
    const content = `<!doctype html>\n<html><head><!--keep--></head><body><section data-agent-native-node-id="main" data-agent-native-component-id="cmp-card"><span data-agent-native-node-id="label">Label</span></section><section data-agent-native-node-id="instance" data-agent-native-component-ref="cmp-card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section></body></html>`;
    const projection = buildCodeLayerProjection(content, { source });
    const label = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "label",
    );
    expect(label).toBeDefined();
    if (!label) return;

    const applyLinkedComponentEdit = vi.fn();
    const applyLocalContentUpdate = vi.fn();
    const remapMotionTracksForClone = vi.fn();
    const selectionBefore: GeometryHistorySelection = {
      activeFileId: file.id,
      overviewSelectedScreenIds: [file.id],
      selectedLayerIds: [label.id, "unrelated-selection"],
      sourceContentByFileId: {},
      sourceFileIdByFileId: {},
    };

    const result = runVisualDuplicateChange(
      {
        activeFile: file,
        applyLinkedComponentEdit,
        componentLinks: {
          sourceFileIds: [file.id],
          targetSource: source,
          documents: [
            { source, content },
            {
              source: { ...source, fileId: "instance-file" },
              content:
                '<section data-agent-native-node-id="instance" data-agent-native-component-ref="cmp-card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section>',
            },
          ],
        },
        applyLocalContentUpdate,
        canEditDesign: true,
        getFreshActiveContent: () => content,
        remapMotionTracksForClone,
        selectionBefore,
        selectedElement: null,
        selectedLayerIdsState: selectionBefore.selectedLayerIds,
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key: string) => key,
        undoManagerRef: { current: null },
      },
      `[data-agent-native-node-id="label"]`,
      '<span data-agent-native-node-id="new-label">New</span>',
      undefined,
      { sourceId: "label" },
    );

    expect(result).toBe(true);
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
    const [targetFileId, targetNodeId, edit, before, onApplied] =
      applyLinkedComponentEdit.mock.calls[0]!;
    expect(targetFileId).toBe(file.id);
    expect(targetNodeId).toBe("main");
    expect(edit).toMatchObject({ kind: "structure", before: content });
    expect(edit.after).toContain("New");
    expect(edit.selectionNodeIds).toHaveLength(1);
    expect(edit.selectionNodeIds[0]).not.toBe(label.id);
    expect(before.activeFileId).toBe(file.id);
    expect(before.selectedLayerIds).toEqual([label.id]);
    expect(before.sourceContentByFileId?.[file.id]).toBe(content);
    expect(onApplied).toEqual(expect.any(Function));
    expect(remapMotionTracksForClone).not.toHaveBeenCalled();

    onApplied();
    expect(remapMotionTracksForClone).toHaveBeenCalledOnce();
    expect(remapMotionTracksForClone.mock.calls[0]?.[0]).toEqual(
      expect.any(Map),
    );
    expect(remapMotionTracksForClone).toHaveBeenCalledWith(
      expect.any(Map),
      file.id,
    );
  });
});
