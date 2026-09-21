import { describe, expect, test } from "vitest";

import {
  canUseActiveDragStateForDrop,
  type LayersPanelMoveIntent,
} from "./LayersPanel";

const dragState = { sourceId: "source", draggedIds: ["source"] };
const intent: LayersPanelMoveIntent = {
  draggedIds: ["source"],
  targetId: "target",
  placement: "inside",
};

describe("canUseActiveDragStateForDrop", () => {
  test("requires a matching active drop intent for empty payload fallback", () => {
    expect(canUseActiveDragStateForDrop(dragState, null, "target")).toBe(false);
    expect(
      canUseActiveDragStateForDrop(
        dragState,
        { ...intent, targetId: "other" },
        "target",
      ),
    ).toBe(false);
    expect(canUseActiveDragStateForDrop(dragState, intent, "target")).toBe(
      true,
    );
  });
});
