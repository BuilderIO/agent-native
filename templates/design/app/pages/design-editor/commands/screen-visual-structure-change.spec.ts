import { describe, expect, it, vi } from "vitest";

import { runScreenVisualStructureChange } from "./screen-visual-structure-change";

describe("runScreenVisualStructureChange", () => {
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
