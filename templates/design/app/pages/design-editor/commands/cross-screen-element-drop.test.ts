import { expect, it } from "vitest";

import { authoredTargetPointForDrop } from "./cross-screen-element-drop";

it("uses local coordinates for an unanchored drop inside board content", () => {
  expect(
    authoredTargetPointForDrop({
      boardFileId: "board",
      targetScreenId: "board",
      targetOutsideBoardContentBounds: false,
      targetCanvasPoint: { x: 310, y: 220 },
      targetLocalPoint: { x: 44, y: 28 },
    }),
  ).toEqual({ x: 44, y: 28 });
});
