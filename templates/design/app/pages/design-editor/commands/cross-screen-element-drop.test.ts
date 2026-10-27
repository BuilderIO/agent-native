import { expect, it } from "vitest";

import { authoredTargetPointForDrop } from "./cross-screen-element-drop";

it("uses canvas coordinates for an unanchored drop inside board content", () => {
  expect(
    authoredTargetPointForDrop({
      boardFileId: "board",
      targetScreenId: "board",
      targetCanvasPoint: { x: 912, y: 764 },
      targetLocalPoint: { x: 5008, y: 4860 },
    }),
  ).toEqual({ x: 912, y: 764 });
});

it("uses local coordinates for an anchored board drop", () => {
  expect(
    authoredTargetPointForDrop({
      boardFileId: "board",
      targetScreenId: "board",
      targetAnchorNodeId: "frame",
      targetCanvasPoint: { x: 912, y: 764 },
      targetLocalPoint: { x: 120, y: 40 },
    }),
  ).toEqual({ x: 120, y: 40 });
});
