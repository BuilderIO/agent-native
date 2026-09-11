import { describe, expect, it } from "vitest";

import {
  replaceSelectionColorsInHtml,
  selectionColorValues,
} from "./edit-panel/document-colors";
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

    expect(values).toEqual([{ property: "color", value: "#111111", count: 3 }]);
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

  it("scans every descendant in a selected source range and counts reuse", () => {
    const content = [
      '<section data-agent-native-node-id="root" style="color:#0066ff">',
      '<div style="background:#0066FF"></div>',
      '<div style="border-color:rgb(0, 102, 255)"></div>',
      '<div style="color:#ff0000"></div>',
      "</section>",
      '<aside style="color:#0066ff"></aside>',
    ].join("");

    expect(
      selectionColorValues(
        [],
        [{ fileId: "screen", content, sourceId: "root" }],
      ),
    ).toEqual([
      { property: "color", value: "#0066ff", count: 3 },
      { property: "color", value: "#ff0000" },
    ]);
  });

  it("replaces a color throughout selected descendants but not outside them", () => {
    const content = [
      '<section data-agent-native-node-id="root" style="color:#0066ff">',
      '<div style="background:#0066FF"></div>',
      "</section>",
      '<aside style="color:#0066ff"></aside>',
    ].join("");
    const next = replaceSelectionColorsInHtml(
      content,
      [{ fileId: "screen", content, sourceId: "root" }],
      "#0066ff",
      "#ff0000",
    );

    expect(next).toBe(
      [
        '<section data-agent-native-node-id="root" style="color:#ff0000">',
        '<div style="background:#ff0000"></div>',
        "</section>",
        '<aside style="color:#0066ff"></aside>',
      ].join(""),
    );
  });

  it("aggregates and replaces the same color across multiple selected ranges", () => {
    const content = [
      '<div data-agent-native-node-id="first" style="color:#0066ff"></div>',
      '<div data-agent-native-node-id="outside" style="color:#0066ff"></div>',
      '<div data-agent-native-node-id="second" style="background:#0066ff"></div>',
    ].join("");
    const scopes = [
      { fileId: "screen", content, sourceId: "first" },
      { fileId: "screen", content, sourceId: "second" },
    ];

    expect(selectionColorValues([], scopes)).toEqual([
      { property: "color", value: "#0066ff", count: 2 },
    ]);
    expect(
      replaceSelectionColorsInHtml(content, scopes, "#0066ff", "#00aa00"),
    ).toBe(
      [
        '<div data-agent-native-node-id="first" style="color:#00aa00"></div>',
        '<div data-agent-native-node-id="outside" style="color:#0066ff"></div>',
        '<div data-agent-native-node-id="second" style="background:#00aa00"></div>',
      ].join(""),
    );
  });
});
