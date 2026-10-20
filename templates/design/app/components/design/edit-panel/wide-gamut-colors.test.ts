// A design can now hold oklch() and color(display-p3 ...) colors. These tests
// pin what each consumer of a color string does with one: read it, key it,
// keep it, or fall back to the CSS Color 4 gamut-mapped sRGB color; never
// flatten it to sRGB silently and never throw on it.
//
// Reference: oklch(0.7 0.3 150) and oklch(0.7 0.6 150) are both outside sRGB
// and both fall back to #00c248 (culori 4.0.2, CSS Color 4 gamut mapping), so
// two different colors can share one sRGB fallback.
import { describe, expect, it } from "vitest";

import {
  extractDocumentColorPalette,
  paletteColorValue,
  replaceSelectionColorsInHtml,
  selectionColorValues,
} from "./document-colors";
import {
  buildGradientLayer,
  buildSolidFillLayer,
  defaultGradientStops,
  parseGradientLayer,
  parseSolidFillLayer,
} from "./fill-gradient-helpers";
import { strokeShowPatch } from "./position-helpers";

const WIDE_A = "oklch(0.7 0.3 150)";
const WIDE_B = "oklch(0.7 0.6 150)";
const P3_RED = "color(display-p3 1 0 0)";

const HTML = [
  "<!doctype html><html><body>",
  `<div data-agent-native-node-id="a" style="background-color: ${WIDE_A}; color: #ffffff">A</div>`,
  `<div data-agent-native-node-id="b" style="background-color: ${WIDE_B}">B</div>`,
  `<div data-agent-native-node-id="c" style="border-color: ${P3_RED}; outline-color: oklch(0.7 0.3 150 / 0)">C</div>`,
  `<div data-agent-native-node-id="d" style="background-color: oklch(0.627955 0.257683 29.234)">D</div>`,
  '<div data-agent-native-node-id="e" style="background-color: #00c248">E</div>',
  "</body></html>",
].join("\n");

const scope = [{ fileId: "f", content: HTML, wholeDocument: true }];

describe("document and selection colors", () => {
  it("lists a color outside sRGB as authored, never as its sRGB fallback", () => {
    const palette = extractDocumentColorPalette([{ id: "f", content: HTML }]);
    expect(palette).toContain(WIDE_A);
    expect(palette).toContain(WIDE_B);
    expect(palette).toContain(P3_RED);
  });

  it("lists a wide-notation color that sits inside sRGB as the hex it is", () => {
    const palette = extractDocumentColorPalette([{ id: "f", content: HTML }]);
    expect(palette).toContain("#FF0000");
    expect(palette).not.toContain("oklch(0.627955 0.257683 29.234)");
  });

  it("keeps the real hex #00C248 separate from the wide colors that fall back to it", () => {
    const palette = extractDocumentColorPalette([{ id: "f", content: HTML }]);
    expect(palette.filter((value) => value === "#00C248")).toHaveLength(1);
    expect(palette).toContain(WIDE_A);
  });

  it("leaves a fully transparent wide color out of the palette", () => {
    const palette = extractDocumentColorPalette([{ id: "f", content: HTML }]);
    expect(palette.some((value) => value.includes("/ 0)"))).toBe(false);
  });

  it("shows selection colors as authored and counts two wide colors with one fallback as two", () => {
    const values = selectionColorValues([], scope).map(({ value }) => value);
    expect(values).toContain(WIDE_A);
    expect(values).toContain(WIDE_B);
    expect(values).toContain(P3_RED);
  });

  it("rewrites one wide color and leaves its same-fallback neighbours alone", () => {
    const next = replaceSelectionColorsInHtml(
      HTML,
      scope,
      WIDE_A,
      "oklch(0.7 0.25 150)",
    );
    expect(next).toContain("background-color: oklch(0.7 0.25 150)");
    expect(next).toContain(`background-color: ${WIDE_B}`);
    expect(next).toContain("background-color: #00c248");
    expect(next).not.toContain(`background-color: ${WIDE_A}`);
  });

  it("does not take a hex edit for a wide color with the same fallback", () => {
    const next = replaceSelectionColorsInHtml(
      HTML,
      scope,
      "#00c248",
      "#123456",
    );
    expect(next).toContain("background-color: #123456");
    expect(next).toContain(`background-color: ${WIDE_A}`);
    expect(next).toContain(`background-color: ${WIDE_B}`);
  });

  it("keeps a wide color as written in the palette and an sRGB color as hex", () => {
    expect(paletteColorValue(WIDE_A)).toBe(WIDE_A);
    expect(paletteColorValue("rgb(10, 107, 214)")).toBe("#0a6bd6");
    expect(paletteColorValue("oklch(0.7 0.3)")).toBeNull();
  });
});

describe("fill layers and gradient stops", () => {
  it("writes and reads a wide solid fill layer without flattening it", () => {
    const layer = buildSolidFillLayer(WIDE_A);
    expect(layer).toBe(`linear-gradient(${WIDE_A} 0 0)`);
    expect(parseSolidFillLayer(layer)).toBe(WIDE_A);
    expect(parseSolidFillLayer(buildSolidFillLayer(P3_RED))).toBe(P3_RED);
  });

  it("builds sRGB solid fill layers exactly as before", () => {
    expect(buildSolidFillLayer("rgb(0, 0, 0)")).toBe(
      "linear-gradient(#000000 0 0)",
    );
    expect(buildSolidFillLayer("rgba(0, 0, 0, 0.5)")).toBe(
      "linear-gradient(rgba(0, 0, 0, 0.5) 0 0)",
    );
  });

  it("still refuses a color it cannot read, loudly", () => {
    expect(() => buildSolidFillLayer("oklch(0.7)")).toThrow(
      /Invalid solid fill color/,
    );
  });

  it("keeps a wide stop wide through build and parse, with opacity in its own notation", () => {
    const layer = buildGradientLayer("linear", [
      { id: "stop-0", color: P3_RED, position: 0, opacity: 50 },
      { id: "stop-1", color: "#0000ff", position: 100, opacity: 100 },
    ]);
    expect(layer).toContain("color(display-p3 1 0 0 / 0.5) 0%");
    const parsed = parseGradientLayer(layer);
    expect(parsed?.stops[0]).toMatchObject({
      color: "color(display-p3 1 0 0 / 0.5)",
      opacity: 50,
    });
    expect(parsed?.stops[1]?.color).toBe("#0000ff");
  });

  it("starts a gradient from a wide fill in that color, with a plain sRGB second stop", () => {
    const [first, second] = defaultGradientStops(P3_RED);
    expect(first?.color).toBe(P3_RED);
    expect(second?.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("stroke restore", () => {
  it("restores a wide stroke color at full opacity in its own notation", () => {
    const patch = strokeShowPatch(
      "border",
      "oklch(70% 0.3 150 / 0.2)",
      "2px",
      "none",
    );
    expect(patch.borderColor).toBe("oklch(70% 0.3 150)");
    expect(patch.borderWidth).toBe("2px");
  });
});
