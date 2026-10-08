import { expect, it } from "vitest";

import { authoredTargetPointForDrop } from "./cross-screen-element-drop";

it("uses board coordinates for an unanchored drop inside the rendered board", () => {
  expect(
    authoredTargetPointForDrop({
      boardFileId: "board",
      targetScreenId: "board",
      targetOutsideBoardRenderGeometry: false,
      targetCanvasPoint: { x: 310, y: 220 },
      targetLocalPoint: { x: 44, y: 28 },
    }),
  ).toEqual({ x: 310, y: 220 });
});
