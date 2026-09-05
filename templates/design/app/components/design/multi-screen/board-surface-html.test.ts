import { describe, expect, it } from "vitest";

import {
  BOARD_SURFACE_BACKGROUND,
  resolveBoardSurfaceBackground,
} from "./board-surface-html";

describe("resolveBoardSurfaceBackground", () => {
  it("prefers the design canvas colour over the theme fallback", () => {
    expect(resolveBoardSurfaceBackground("#d67676", "hsl(0 0% 10%)")).toBe(
      "#d67676",
    );
  });

  it("falls back to the themed canvas colour when unset", () => {
    expect(resolveBoardSurfaceBackground(null, "hsl(0 0% 92%)")).toBe(
      "hsl(0 0% 92%)",
    );
    expect(resolveBoardSurfaceBackground("  ", "hsl(0 0% 92%)")).toBe(
      "hsl(0 0% 92%)",
    );
  });

  it("uses the board default when neither colour is set", () => {
    expect(resolveBoardSurfaceBackground(null, "")).toBe(
      BOARD_SURFACE_BACKGROUND,
    );
  });
});
