import { describe, expect, it } from "vitest";

import { selectionColorValues } from "./edit-panel/document-colors";
import { extractDocumentColorPalette } from "./EditPanel";
import type { ElementInfo } from "./types";

function fakeElement(computedStyles: Record<string, string>): ElementInfo {
  return {
    tagName: "DIV",
    classes: [],
    computedStyles,
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
  };
}

describe("extractDocumentColorPalette", () => {
  it("collects hex colors from inline styles across multiple files", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content:
          '<div style="color: #FF0000; background-color: #00ff00;"></div>',
      },
      {
        id: "file-2",
        content: '<span style="border-color:#0000FF;"></span>',
      },
    ]);

    expect(palette).toEqual(
      expect.arrayContaining(["#FF0000", "#00FF00", "#0000FF"]),
    );
    expect(palette).toHaveLength(3);
  });

  it("normalizes different formats of the same color to one deduped entry", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content:
          '<div style="color: #ff0000;"></div><div style="color: rgb(255, 0, 0);"></div><div style="color: #f00;"></div>',
      },
    ]);

    expect(palette).toEqual(["#FF0000"]);
  });

  it("parses colors out of <style> blocks, not just inline style attributes", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content:
          "<style>.card { background: hsl(210, 50%, 50%); }</style><div class='card'></div>",
      },
    ]);

    expect(palette).toHaveLength(1);
    expect(palette[0]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("orders results by descending frequency (most-used colors first)", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content: [
          '<div style="color:#111111;">',
          '<div style="color:#111111;">',
          '<div style="color:#111111;">',
          '<div style="color:#222222;">',
          '<div style="color:#222222;">',
          '<div style="color:#333333;">',
        ].join(""),
      },
    ]);

    expect(palette).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("skips fully transparent colors", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content:
          '<div style="color: rgba(0,0,0,0); background: #ABCDEF;"></div>',
      },
    ]);

    expect(palette).toEqual(["#ABCDEF"]);
  });

  it("caps results at the given limit, keeping the most frequent colors", () => {
    const content = Array.from({ length: 30 }, (_, i) => {
      const hex = i.toString(16).padStart(2, "0");
      // Repeat earlier colors more often than later ones so frequency order
      // is unambiguous once capped.
      const repeats = 30 - i;
      return `<div style="color:#${hex}${hex}${hex};">`.repeat(repeats);
    }).join("");

    const palette = extractDocumentColorPalette([{ id: "f", content }], 5);

    expect(palette).toHaveLength(5);
    // The 5 most-repeated colors are the first 5 generated (i = 0..4).
    expect(palette).toEqual([
      "#000000",
      "#010101",
      "#020202",
      "#030303",
      "#040404",
    ]);
  });

  it("returns an empty array for files with no colors", () => {
    expect(
      extractDocumentColorPalette([{ id: "f", content: "<div>hi</div>" }]),
    ).toEqual([]);
  });

  it("handles an empty files list", () => {
    expect(extractDocumentColorPalette([])).toEqual([]);
  });

  it("ignores unparseable color-shaped tokens without throwing", () => {
    expect(() =>
      extractDocumentColorPalette([
        { id: "f", content: '<div style="color: rgb(not, a, color)">' },
      ]),
    ).not.toThrow();
  });
});

describe("selectionColorValues", () => {
  it("skips the literal transparent spellings (existing behavior)", () => {
    const values = selectionColorValues(
      fakeElement({
        color: "rgb(0, 0, 0)",
        backgroundColor: "transparent",
        borderColor: "rgba(0, 0, 0, 0)",
        outlineColor: "",
      }),
    );

    expect(values).toEqual([{ property: "color", value: "rgb(0, 0, 0)" }]);
  });

  it("skips any other zero-alpha color, not just the two literal spellings", () => {
    // Regression: this used to only filter the exact strings "transparent"
    // and "rgba(0, 0, 0, 0)" — a zero-alpha color with any other RGB
    // channels or formatting (e.g. a non-black rgba, or hsla) slipped
    // through as a bogus, effectively-invisible "selection color" swatch.
    const values = selectionColorValues(
      fakeElement({
        color: "rgb(0, 0, 0)",
        backgroundColor: "rgba(255, 0, 0, 0)",
        borderColor: "hsla(210, 50%, 50%, 0)",
        outlineColor: "rgba(0,0,0,0)",
      }),
    );

    expect(values).toEqual([{ property: "color", value: "rgb(0, 0, 0)" }]);
  });

  it("keeps visible colors with non-zero alpha", () => {
    const values = selectionColorValues(
      fakeElement({
        color: "#111111",
        backgroundColor: "rgba(255, 0, 0, 0.5)",
        borderColor: "",
        outlineColor: "",
      }),
    );

    expect(values).toEqual([
      { property: "color", value: "#111111" },
      { property: "backgroundColor", value: "rgba(255, 0, 0, 0.5)" },
    ]);
  });

  it("dedupes equal colors across properties", () => {
    const values = selectionColorValues(
      fakeElement({
        color: "#111111",
        backgroundColor: "#111111",
        borderColor: "#111111",
        outlineColor: "",
      }),
    );

    expect(values).toEqual([{ property: "color", value: "#111111" }]);
  });

  it("keeps unparseable non-color values through (e.g. a Mixed sentinel)", () => {
    const values = selectionColorValues(
      fakeElement({
        color: "Mixed",
        backgroundColor: "",
        borderColor: "",
        outlineColor: "",
      }),
    );

    expect(values).toEqual([{ property: "color", value: "Mixed" }]);
  });
});
