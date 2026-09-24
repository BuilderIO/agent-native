// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { runScreenVisualStructureChange } from "./screen-visual-structure-change";

describe("runScreenVisualStructureChange", () => {
  it("dispatches an inactive same-main pointer move with exact geometry", () => {
    const content =
      '<body><main data-agent-native-node-id="main" data-agent-native-component-id="card">' +
      '<div data-agent-native-node-id="target">Target</div>' +
      '<div data-agent-native-node-id="anchor">Anchor</div>' +
      "</main></body>";
    const applyLinkedComponentEdit = vi.fn();
    const applyFileContentUpdate = vi.fn();

    const result = runScreenVisualStructureChange(
      {
        activeFile: { id: "active" } as never,
        applyLinkedComponentEdit,
        applyFileContentUpdate,
        canEditDesign: true,
        designSourceType: "inline",
        getScreenContent: vi.fn(() => content),
        handleVisualStructureChange: vi.fn(),
        overviewScreens: [
          {
            id: "inactive",
            filename: "inactive.html",
            content,
            sourceType: "inline",
            updatedAt: "now",
          } as never,
        ],
        recordPendingLiveStructureEdit: vi.fn(),
        setActiveFileId: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
      },
      "inactive",
      '[data-agent-native-node-id="target"]',
      '[data-agent-native-node-id="anchor"]',
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
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(applyLinkedComponentEdit).toHaveBeenCalledExactlyOnceWith(
      "inactive",
      "main",
      expect.objectContaining({ kind: "structure", before: content }),
    );
    const edit = applyLinkedComponentEdit.mock.calls[0]?.[2];
    expect(edit.after).toContain("left: 40px");
    expect(edit.after).toContain("top: 20px");
  });

  it("queues an inserted Fusion runtime node instead of resolving it in stored HTML", () => {
    const recordPendingLiveStructureEdit = vi.fn();
    const getScreenContent = vi.fn(() => {
      throw new Error("Fusion runtime nodes are not stored in screen HTML");
    });

    const result = runScreenVisualStructureChange(
      {
        activeFile: { id: "active" } as never,
        applyFileContentUpdate: vi.fn(),
        canEditDesign: true,
        designSourceType: "inline",
        getScreenContent,
        handleVisualStructureChange: vi.fn(),
        overviewScreens: [
          {
            id: "fusion-screen",
            sourceType: "fusion",
          } as never,
        ],
        recordPendingLiveStructureEdit,
        setActiveFileId: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
      },
      "fusion-screen",
      '[data-agent-native-node-id="clone"]',
      '[data-agent-native-node-id="anchor"]',
      "after",
      undefined,
      {
        sourceId: "clone",
        anchorSourceId: "anchor",
        insertedHtml: '<div data-agent-native-node-id="clone"></div>',
      },
    );

    expect(result).toBe("pending");
    expect(recordPendingLiveStructureEdit).toHaveBeenCalledWith(
      "fusion-screen",
      '[data-agent-native-node-id="clone"]',
      '[data-agent-native-node-id="anchor"]',
      "after",
      undefined,
      expect.objectContaining({
        sourceId: "clone",
        insertedHtml: expect.any(String),
      }),
    );
    expect(getScreenContent).not.toHaveBeenCalled();
  });
});
