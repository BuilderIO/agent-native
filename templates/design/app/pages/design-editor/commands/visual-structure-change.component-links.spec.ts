import { describe, expect, it, vi } from "vitest";
// @vitest-environment happy-dom

import { runVisualStructureChange } from "./visual-structure-change";

const source = {
  kind: "design-file" as const,
  designId: "design",
  fileId: "screen",
};
const content =
  '<main data-agent-native-node-id="main" data-agent-native-component-id="card">' +
  '<div data-agent-native-node-id="target">Target</div>' +
  '<div data-agent-native-node-id="anchor">Anchor</div>' +
  "</main>";
const selector = '[data-agent-native-node-id="target"]';
const anchorSelector = '[data-agent-native-node-id="anchor"]';

describe("runVisualStructureChange linked component routing", () => {
  it("dispatches a same-main reorder atomically without a local source write", () => {
    const applyLinkedComponentEdit = vi.fn();
    const applyLocalContentUpdate = vi.fn();
    const result = runVisualStructureChange(
      {
        activeCanvasSourceType: "inline",
        activeFile: { id: source.fileId } as never,
        applyLinkedComponentEdit,
        applyLocalContentUpdate,
        canEditDesign: true,
        getFreshActiveContent: () => content,
        recordPendingLiveStructureEdit: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key: string) => key,
      },
      selector,
      anchorSelector,
      "after",
    );

    expect(result).toBe(true);
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
    const [fileId, nodeId, edit] = applyLinkedComponentEdit.mock.calls[0]!;
    expect([fileId, nodeId]).toEqual([source.fileId, "main"]);
    expect(edit).toMatchObject({
      kind: "structure",
      before: content,
      selectionNodeIds: ["target"],
    });
    const main = new DOMParser()
      .parseFromString(edit.after, "text/html")
      .querySelector("main");
    expect(
      Array.from(main?.children ?? [], (child) =>
        child.getAttribute("data-agent-native-node-id"),
      ),
    ).toEqual(["anchor", "target"]);
  });

  it("uses a source snapshot when pointer positioning adds exact geometry", () => {
    const applyLinkedComponentEdit = vi.fn();
    const applyLocalContentUpdate = vi.fn();
    const result = runVisualStructureChange(
      {
        activeCanvasSourceType: "inline",
        activeFile: { id: source.fileId } as never,
        applyLinkedComponentEdit,
        applyLocalContentUpdate,
        canEditDesign: true,
        getFreshActiveContent: () => content,
        recordPendingLiveStructureEdit: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key: string) => key,
      },
      selector,
      anchorSelector,
      "after",
      undefined,
      {
        sourceId: "target",
        anchorSourceId: "anchor",
        dropMode: "absolute-container",
        sourceRect: { x: 50, y: 40, width: 20, height: 20 },
        anchorRect: { x: 10, y: 20, width: 20, height: 20 },
      },
    );

    expect(result).toBe(true);
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    const edit = applyLinkedComponentEdit.mock.calls[0]?.[2];
    expect(edit).toMatchObject({ kind: "structure" });
    expect(edit).toHaveProperty("before", content);
    expect(edit).toHaveProperty("after");
    expect(edit.after).toContain("left: 40px");
    expect(edit.after).toContain("top: 20px");
  });
});
