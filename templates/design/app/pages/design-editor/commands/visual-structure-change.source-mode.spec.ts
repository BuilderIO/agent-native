import { describe, expect, it, vi } from "vitest";

import { runScreenVisualStructureChange } from "./screen-visual-structure-change";
import { runVisualStructureChange } from "./visual-structure-change";

const selector = '[data-agent-native-node-id="target"]';
const anchorSelector = '[data-agent-native-node-id="anchor"]';

for (const sourceType of ["localhost", "fusion"] as const) {
  describe(`${sourceType} visual structure changes`, () => {
    it("queues active-screen changes without reading stored HTML", () => {
      const recordPendingLiveStructureEdit = vi.fn();
      const getFreshActiveContent = vi.fn(() => {
        throw new Error("running app markup is not stored in Design HTML");
      });

      const result = runVisualStructureChange(
        {
          activeCanvasSourceType: sourceType,
          activeFile: { id: "active-screen" } as never,
          applyLocalContentUpdate: vi.fn(),
          canEditDesign: true,
          getFreshActiveContent,
          recordPendingLiveStructureEdit,
          setSelectedElement: vi.fn(),
          setSelectedLayerIdsState: vi.fn(),
          t: (key) => key,
        },
        selector,
        anchorSelector,
        "after",
        undefined,
        { sourceId: "target", anchorSourceId: "anchor" },
      );

      expect(result).toBe("pending");
      expect(getFreshActiveContent).not.toHaveBeenCalled();
      expect(recordPendingLiveStructureEdit).toHaveBeenCalledWith(
        "active-screen",
        selector,
        anchorSelector,
        "after",
        undefined,
        expect.objectContaining({
          sourceId: "target",
          anchorSourceId: "anchor",
        }),
      );
    });

    it("queues inactive-screen changes without reading stored HTML or changing selection", () => {
      const recordPendingLiveStructureEdit = vi.fn();
      const getScreenContent = vi.fn(() => {
        throw new Error("running app markup is not stored in Design HTML");
      });
      const setActiveFileId = vi.fn();
      const handleVisualStructureChange = vi.fn();

      const result = runScreenVisualStructureChange(
        {
          activeFile: { id: "active-screen" } as never,
          applyFileContentUpdate: vi.fn(),
          canEditDesign: true,
          designSourceType: "inline",
          getScreenContent,
          handleVisualStructureChange,
          overviewScreens: [{ id: "other-screen", sourceType } as never],
          recordPendingLiveStructureEdit,
          setActiveFileId,
          setSelectedElement: vi.fn(),
          setSelectedLayerIdsState: vi.fn(),
          t: (key) => key,
        },
        "other-screen",
        selector,
        anchorSelector,
        "after",
        undefined,
        { sourceId: "target", anchorSourceId: "anchor" },
      );

      expect(result).toBe("pending");
      expect(getScreenContent).not.toHaveBeenCalled();
      expect(handleVisualStructureChange).not.toHaveBeenCalled();
      expect(setActiveFileId).not.toHaveBeenCalled();
      expect(recordPendingLiveStructureEdit).toHaveBeenCalledWith(
        "other-screen",
        selector,
        anchorSelector,
        "after",
        undefined,
        expect.objectContaining({
          sourceId: "target",
          anchorSourceId: "anchor",
        }),
      );
    });
  });
}

describe("inline grid structure changes", () => {
  it("persists the held cell after moving an explicitly placed child", () => {
    let published = "";
    const result = runVisualStructureChange(
      {
        activeCanvasSourceType: "inline",
        activeFile: { id: "active-screen" } as never,
        applyLocalContentUpdate: (content) => {
          published = content;
          return {
            status: "accepted",
            content,
            nodeIdMap: new Map(),
          } as never;
        },
        canEditDesign: true,
        getFreshActiveContent: () =>
          '<div data-agent-native-node-id="grid"><div data-agent-native-node-id="target" style="grid-column: 2 / span 2; grid-row: 1"></div><div data-agent-native-node-id="anchor"></div><div data-agent-native-node-id="c" style="grid-column: 1; grid-row: 2"></div></div>',
        recordPendingLiveStructureEdit: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
      },
      '[data-agent-native-node-id="target"]',
      '[data-agent-native-node-id="anchor"]',
      "inside",
      undefined,
      {
        sourceId: "target",
        anchorSourceId: "grid",
        gridPlacement: { column: 1, columnEnd: 3, row: 2, rowEnd: 3 },
        gridDisplacements: [
          {
            sourceId: "c",
            selector: '[data-agent-native-node-id="c"]',
            placement: { column: 2, columnEnd: 4, row: 1, rowEnd: 2 },
          },
        ],
      },
    );

    expect(result).toBe(true);
    expect(published).toContain("grid-column: 1 / 3");
    expect(published).toContain("grid-row: 2 / 3");
    expect(published).toContain("grid-column: 2 / 4");
    expect(published).toContain("grid-row: 1 / 2");
  });
});
