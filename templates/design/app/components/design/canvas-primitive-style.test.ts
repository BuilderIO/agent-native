import { describe, expect, it } from "vitest";

import {
  canvasPrimitiveReactStyle,
  canvasPrimitiveVisual,
} from "./canvas-primitive-style";

describe("canvas text primitive style", () => {
  it("leaves text outlines to editor selection chrome", () => {
    expect(canvasPrimitiveVisual("text").border).toBe("0 solid transparent");
    expect(canvasPrimitiveReactStyle("text")).toMatchObject({
      borderWidth: 0,
      borderStyle: "solid",
      background: "transparent",
    });
  });
});
