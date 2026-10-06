import { describe, expect, it } from "vitest";

import {
  getDesignCanvasBackground,
  sanitizeCanvasBackground,
} from "./data-operations";

describe("getDesignCanvasBackground", () => {
  it("reads a persisted hex colour", () => {
    expect(getDesignCanvasBackground({ canvasBackground: "#E8E0D0" })).toBe(
      "#E8E0D0",
    );
  });

  it("accepts rgb/rgba and named colours", () => {
    expect(
      getDesignCanvasBackground({ canvasBackground: "rgba(0, 0, 0, 0.5)" }),
    ).toBe("rgba(0, 0, 0, 0.5)");
    expect(getDesignCanvasBackground({ canvasBackground: "red" })).toBe("red");
  });

  it("returns null when unset", () => {
    expect(getDesignCanvasBackground({})).toBeNull();
    expect(getDesignCanvasBackground(null)).toBeNull();
    expect(getDesignCanvasBackground(undefined)).toBeNull();
    expect(getDesignCanvasBackground({ canvasBackground: "  " })).toBeNull();
  });

  it("rejects a non-colour string rather than trusting it", () => {
    expect(
      getDesignCanvasBackground({ canvasBackground: "red; position: fixed" }),
    ).toBeNull();
    expect(
      getDesignCanvasBackground({
        canvasBackground: "url(javascript:alert(1))",
      }),
    ).toBeNull();
    expect(
      getDesignCanvasBackground({ canvasBackground: "}</style><script>" }),
    ).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(getDesignCanvasBackground({ canvasBackground: 123 })).toBeNull();
    expect(
      getDesignCanvasBackground({ canvasBackground: { hex: "#fff" } }),
    ).toBeNull();
  });
});

describe("sanitizeCanvasBackground", () => {
  it("accepts a colour a drag preview would produce", () => {
    expect(sanitizeCanvasBackground("#1a2b3c")).toBe("#1a2b3c");
    expect(sanitizeCanvasBackground("  #fff  ")).toBe("#fff");
  });

  it("rejects the same injection shapes as the persisted reader", () => {
    expect(sanitizeCanvasBackground("red; position: fixed")).toBeNull();
    expect(sanitizeCanvasBackground("")).toBeNull();
    expect(sanitizeCanvasBackground(null)).toBeNull();
    expect(sanitizeCanvasBackground(42)).toBeNull();
  });
});
