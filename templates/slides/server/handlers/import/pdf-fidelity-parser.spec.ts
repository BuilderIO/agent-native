import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import {
  annotateLineDecorations,
  applyPoint,
  contrastingDefaultColor,
  groupIntoBlocks,
  groupIntoLines,
  mergeLine,
  textItemToBox,
  walkPageGraphics,
  type LinkRect,
  type Mat,
  type TextRunBox,
  type UnderlineRect,
} from "./pdf-fidelity-parser.js";

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

describe("applyPoint", () => {
  it("translates a point", () => {
    expect(applyPoint([1, 0, 0, 1, 10, 20], 5, 5)).toEqual([15, 25]);
  });

  it("flips y for a top-left/y-down viewport transform", () => {
    // pdf.js viewports commonly look like this: flip y and offset by page height.
    const viewportTransform: Mat = [1, 0, 0, -1, 0, 792];
    expect(applyPoint(viewportTransform, 0, 792)).toEqual([0, 0]);
    expect(applyPoint(viewportTransform, 0, 0)).toEqual([0, 792]);
  });
});

describe("textItemToBox", () => {
  it("places an unrotated run's box around its baseline using font size", () => {
    const box = textItemToBox(
      { str: "Hello", transform: [12, 0, 0, 12, 100, 200], width: 40 },
      IDENTITY,
    );
    expect(box).toBeDefined();
    expect(box!.text).toBe("Hello");
    expect(box!.fontSize).toBeCloseTo(12);
    expect(box!.left).toBeCloseTo(100);
    expect(box!.right).toBeCloseTo(140);
    // Box spans from below the baseline (descent) to above it (ascent).
    expect(box!.top).toBeLessThan(200);
    expect(box!.bottom).toBeGreaterThan(200);
  });

  it("skips whitespace-only items", () => {
    expect(
      textItemToBox({ str: "   ", transform: IDENTITY, width: 10 }, IDENTITY),
    ).toBeUndefined();
  });

  it("detects bold/italic from the font name", () => {
    const box = textItemToBox(
      {
        str: "Title",
        transform: [20, 0, 0, 20, 0, 0],
        width: 80,
        fontName: "ABCDEF+Arial-BoldItalicMT",
      },
      IDENTITY,
    );
    expect(box!.bold).toBe(true);
    expect(box!.italic).toBe(true);
  });

  it("defaults to black when no color is passed", () => {
    const box = textItemToBox(
      { str: "Plain", transform: IDENTITY, width: 10 },
      IDENTITY,
    );
    expect(box!.color).toBe("#000000");
  });

  it("carries the real fill color through when one is passed", () => {
    const box = textItemToBox(
      { str: "Blue", transform: IDENTITY, width: 10 },
      IDENTITY,
      "#0066ff",
    );
    expect(box!.color).toBe("#0066ff");
  });
});

function box(partial: Partial<TextRunBox>): TextRunBox {
  return {
    text: "x",
    left: 0,
    top: 0,
    right: 10,
    bottom: 10,
    fontSize: 10,
    bold: false,
    italic: false,
    color: "#000000",
    underline: false,
    href: undefined,
    ...partial,
  };
}

describe("mergeLine", () => {
  it("joins runs left-to-right without a space when adjacent", () => {
    const merged = mergeLine([
      box({ text: "Hel", left: 0, right: 20 }),
      box({ text: "lo", left: 20, right: 35 }),
    ]);
    expect(merged.text).toBe("Hello");
  });

  it("carries the leftmost run color", () => {
    const merged = mergeLine([
      box({ text: "Nike", left: 0, right: 30, color: "#0066ff" }),
      box({ text: "NYC", left: 32, right: 55, color: "#0066ff" }),
    ]);
    expect(merged.color).toBe("#0066ff");
  });

  it("inserts a space across a word-sized gap", () => {
    const merged = mergeLine([
      box({ text: "Hello", left: 0, right: 20, fontSize: 10 }),
      box({ text: "World", left: 30, right: 50, fontSize: 10 }),
    ]);
    expect(merged.text).toBe("Hello World");
  });
});

describe("groupIntoLines", () => {
  it("keeps items with close baselines on the same line", () => {
    const lines = groupIntoLines([
      box({
        text: "A",
        top: 100,
        bottom: 112,
        fontSize: 12,
        left: 0,
        right: 10,
      }),
      box({
        text: "B",
        top: 101,
        bottom: 113,
        fontSize: 12,
        left: 10,
        right: 20,
      }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("AB");
  });

  it("starts a new line on a large vertical jump", () => {
    const lines = groupIntoLines([
      box({ text: "A", top: 100, bottom: 112, fontSize: 12 }),
      box({ text: "B", top: 200, bottom: 212, fontSize: 12 }),
    ]);
    expect(lines).toHaveLength(2);
  });
});

describe("groupIntoBlocks", () => {
  it("keeps same-size consecutive lines in one block", () => {
    const lines: TextRunBox[] = [
      box({ text: "Line 1", top: 0, bottom: 14, fontSize: 14, left: 0 }),
      box({ text: "Line 2", top: 16, bottom: 30, fontSize: 14, left: 0 }),
    ];
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveLength(2);
  });

  it("splits a heading from body text on a font-size change", () => {
    const lines: TextRunBox[] = [
      box({ text: "Heading", top: 0, bottom: 40, fontSize: 40, left: 0 }),
      box({ text: "Body", top: 80, bottom: 96, fontSize: 16, left: 0 }),
    ];
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(2);
  });

  it("splits blocks separated by a large vertical gap", () => {
    const lines: TextRunBox[] = [
      box({ text: "Para 1", top: 0, bottom: 14, fontSize: 14, left: 0 }),
      box({ text: "Para 2", top: 100, bottom: 114, fontSize: 14, left: 0 }),
    ];
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(2);
  });
});

describe("contrastingDefaultColor", () => {
  it("reads white on a dark background so text stays visible", () => {
    expect(contrastingDefaultColor("#000000")).toBe("#ffffff");
  });

  it("reads black on a light background", () => {
    expect(contrastingDefaultColor("#ffffff")).toBe("#000000");
  });

  it("defaults to black when no background was detected (plain paper)", () => {
    expect(contrastingDefaultColor(undefined)).toBe("#000000");
  });

  it("defaults to white when no vector fill was found but a full-bleed photo covers the page", () => {
    expect(contrastingDefaultColor(undefined, true)).toBe("#ffffff");
  });
});

function fakePage(fnArray: number[], argsArray: unknown[][]) {
  return {
    getOperatorList: async () => ({ fnArray, argsArray }),
  } as unknown as Parameters<typeof walkPageGraphics>[0];
}

const VIEWPORT = { transform: IDENTITY, width: 100, height: 100 };

describe("walkPageGraphics", () => {
  it("reads the real color from a recognized rg op (pdf.js pre-resolves it to a hex string, not raw r/g/b numbers)", async () => {
    const page = fakePage(
      [OPS.setFillRGBColor, OPS.showText],
      [["#0000ff"], [{}]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.textColors).toEqual(["#0000ff"]);
  });

  it("marks the color unknown after a named Pattern fill (scn with a pattern name), instead of reusing a stale value", async () => {
    const page = fakePage(
      [OPS.setFillColorN, OPS.showText],
      [["Pattern1"], [{}]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.textColors).toEqual([undefined]);
  });

  it("decodes a resolved hex color from a setFillColorN op (ICCBased/CalRGB/Separation colors routed through scn are pre-resolved to a hex string the same way rg is)", async () => {
    const page = fakePage(
      [OPS.setFillColorN, OPS.showText],
      [["#ffffff"], [{}]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.textColors).toEqual(["#ffffff"]);
  });

  it("decodes a resolved hex color from a setFillColorN op, matching a solid black page background set via scn instead of rg/g", async () => {
    const page = fakePage(
      [OPS.setFillColorN, OPS.constructPath],
      [["#000000"], [OPS.fill, [], [0, 0, 100, 100]]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.backgroundColor).toBe("#000000");
  });

  it("detects a full-page fill as the background when the color is known", async () => {
    const page = fakePage(
      [OPS.setFillRGBColor, OPS.constructPath],
      [["#000000"], [OPS.fill, [], [0, 0, 100, 100]]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.backgroundColor).toBe("#000000");
  });

  it("does not guess a background color from an undecoded colorspace fill", async () => {
    const page = fakePage(
      [OPS.setFillColorN, OPS.constructPath],
      [["Pattern1"], [OPS.fill, [], [0, 0, 100, 100]]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.backgroundColor).toBeUndefined();
  });

  it("collects a thin filled rect as an underline candidate", async () => {
    const page = fakePage(
      [OPS.setFillRGBColor, OPS.constructPath],
      [["#000000"], [OPS.fill, [], [10, 50, 40, 51]]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.underlineRects).toEqual([
      { left: 10, top: 50, right: 40, bottom: 51 },
    ]);
  });

  it("collects a zero-height stroked hairline as an underline candidate", async () => {
    const page = fakePage(
      [OPS.setFillRGBColor, OPS.constructPath],
      [["#000000"], [OPS.stroke, [], [10, 50, 40, 50]]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.underlineRects).toEqual([
      { left: 10, top: 50, right: 40, bottom: 50 },
    ]);
  });

  it("ignores a degenerate zero-length stroke (a point, not a line)", async () => {
    const page = fakePage(
      [OPS.setFillRGBColor, OPS.constructPath],
      [["#000000"], [OPS.stroke, [], [10, 50, 10, 50]]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.underlineRects).toEqual([]);
  });

  it("does not mistake a large filled block for an underline", async () => {
    const page = fakePage(
      [OPS.setFillRGBColor, OPS.constructPath],
      [["#000000"], [OPS.fill, [], [10, 10, 40, 40]]],
    );
    const graphics = await walkPageGraphics(page, VIEWPORT);
    expect(graphics.underlineRects).toEqual([]);
  });
});

function underlineRect(partial: Partial<UnderlineRect>): UnderlineRect {
  return { left: 0, top: 0, right: 10, bottom: 1, ...partial };
}

function linkRect(partial: Partial<LinkRect>): LinkRect {
  return {
    left: 0,
    top: 0,
    right: 10,
    bottom: 10,
    url: "https://x.test",
    ...partial,
  };
}

describe("annotateLineDecorations", () => {
  it("marks a line underlined when a thin rect sits just below it", () => {
    const line = box({ text: "Link", left: 0, top: 0, right: 40, bottom: 12 });
    const [annotated] = annotateLineDecorations(
      [line],
      [underlineRect({ left: 0, right: 40, top: 13, bottom: 14 })],
      [],
    );
    expect(annotated.underline).toBe(true);
  });

  it("does not underline a line when the rect is far below it", () => {
    const line = box({ text: "Plain", left: 0, top: 0, right: 40, bottom: 12 });
    const [annotated] = annotateLineDecorations(
      [line],
      [underlineRect({ left: 0, right: 40, top: 60, bottom: 61 })],
      [],
    );
    expect(annotated.underline).toBe(false);
  });

  it("assigns the annotation's url when a line falls inside a Link rect", () => {
    const line = box({
      text: "Visit us",
      left: 0,
      top: 0,
      right: 40,
      bottom: 12,
    });
    const [annotated] = annotateLineDecorations(
      [line],
      [],
      [
        linkRect({
          left: 0,
          top: 0,
          right: 40,
          bottom: 12,
          url: "https://example.com",
        }),
      ],
    );
    expect(annotated.href).toBe("https://example.com");
  });

  it("leaves href undefined when no Link annotation overlaps the line", () => {
    const line = box({
      text: "No link",
      left: 0,
      top: 0,
      right: 40,
      bottom: 12,
    });
    const [annotated] = annotateLineDecorations(
      [line],
      [],
      [linkRect({ left: 200, top: 200, right: 240, bottom: 212 })],
    );
    expect(annotated.href).toBeUndefined();
  });
});
