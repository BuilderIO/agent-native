import { describe, expect, it } from "vitest";

import { getDesignCanvasBackground } from "./data-operations";

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
    // This value is interpolated into a style attribute, so an arbitrary
    // persisted string would be a CSS injection vector.
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
