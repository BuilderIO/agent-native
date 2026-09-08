import { describe, expect, it } from "vitest";

import { canvasFrameSize } from "./CanvasArea";

describe("CanvasArea artboard sizing", () => {
  it("keeps the surface width but honors a taller explicit frame", () => {
    expect(
      canvasFrameSize({ id: "manual", surface: "browser", height: 720 }),
    ).toEqual({ width: 900, height: 720 });
  });

  it("does not let an undersized frame crop the surface preset", () => {
    expect(
      canvasFrameSize({ id: "short", surface: "browser", height: 320 }),
    ).toEqual({ width: 900, height: 560 });
  });
});
