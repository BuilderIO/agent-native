import { describe, expect, it } from "vitest";

import {
  layoutDocumentPdf,
  renderDocumentPdf,
  type PdfCanvas,
  type PdfFont,
  type Rgb,
} from "./document-pdf.js";

type Op =
  | {
      kind: "text";
      page: number;
      text: string;
      x: number;
      y: number;
      font: PdfFont;
      color: Rgb;
    }
  | { kind: "line"; page: number; y1: number; y2: number }
  | { kind: "fill"; page: number; y: number; color: Rgb }
  | { kind: "link"; page: number; url: string };

function recordLayout(title: string, content: string) {
  const ops: Op[] = [];
  let page = 1;
  let pageCount = 1;
  const measure = (text: string, font: PdfFont) =>
    text.length * font.size * 0.5;
  const canvas: PdfCanvas = {
    width: 612,
    height: 792,
    get page() {
      return page;
    },
    get pageCount() {
      return pageCount;
    },
    addPage: () => {
      pageCount += 1;
      page = pageCount;
    },
    setPage: (next) => {
      page = next;
    },
    measure,
    text: (text, x, y, font, color) => {
      ops.push({ kind: "text", page, text, x, y, font, color });
    },
    line: (_x1, y1, _x2, y2) => {
      ops.push({ kind: "line", page, y1, y2 });
    },
    fill: (_x, y, _width, _height, color) => {
      ops.push({ kind: "fill", page, y, color });
    },
    link: (_x, _y, _width, _height, url) => {
      ops.push({ kind: "link", page, url });
    },
  };
  layoutDocumentPdf({ title, content }, canvas);
  const texts = ops.filter(
    (op): op is Extract<Op, { kind: "text" }> => op.kind === "text",
  );
  const textOf = (text: string) => {
    const found = texts.find((op) => op.text === text);
    if (!found)
      throw new Error(
        `No text "${text}" in ${texts.map((op) => op.text).join(" | ")}`,
      );
    return found;
  };
  return { ops, texts, textOf, pageCount, measure };
}

describe("document PDF layout", () => {
  it("keeps each line of a poem, and the blank line between stanzas", () => {
    const { texts, textOf } = recordLayout(
      "Poem",
      ["first line", "second line", "<empty-block/>", "third line"].join("\n"),
    );

    expect(texts.map((op) => op.text)).toEqual([
      "Poem",
      "first line",
      "second line",
      "third line",
      "1 / 1",
    ]);
    const lineGap = textOf("second line").y - textOf("first line").y;
    const stanzaGap = textOf("third line").y - textOf("second line").y;
    expect(stanzaGap - lineGap).toBeGreaterThanOrEqual(16);
  });

  it("starts a new line at a hard line break and keeps its indent", () => {
    const { textOf } = recordLayout("Lines", "a line<br>  indented");

    expect(textOf("  indented").y).toBeGreaterThan(textOf("a line").y);
    expect(textOf("  indented").x).toBe(textOf("a line").x);
  });

  it("wraps long text inside the margins and carries on to the next page", () => {
    const words = Array.from({ length: 1800 }, (_, index) => `word${index}`);
    const { texts, pageCount, measure } = recordLayout("Long", words.join(" "));

    expect(pageCount).toBeGreaterThan(1);
    for (const op of texts) {
      expect(op.x).toBeGreaterThanOrEqual(54);
      expect(op.x + measure(op.text, op.font)).toBeLessThanOrEqual(612 - 54);
      expect(op.y).toBeLessThanOrEqual(792 - 54 / 2);
    }
    expect(texts.map((op) => op.text).slice(-1)).toEqual([
      `${pageCount} / ${pageCount}`,
    ]);
    expect(texts.map((op) => op.text).join(" ")).toContain("word0 word1");
    expect(texts.map((op) => op.text).join(" ")).toContain("word1799");
  });

  it("styles bold, italic, code and links, and links only web addresses", () => {
    const { ops, textOf } = recordLayout(
      "Styles",
      "**bold** *italic* `code` [site](https://example.com) [bad](javascript:alert(1))",
    );

    expect(textOf("bold").font.bold).toBe(true);
    expect(textOf("italic").font.italic).toBe(true);
    expect(textOf("code").font.mono).toBe(true);
    expect(textOf(" bad").font.mono).toBe(false);
    expect(ops.filter((op) => op.kind === "link").map((op) => op.url)).toEqual([
      "https://example.com/",
    ]);
  });

  it("puts list numbers, bullets and checkboxes beside their items", () => {
    const { ops, textOf } = recordLayout(
      "Lists",
      ["1. one", "2. two", "- dot", "- [x] done"].join("\n"),
    );

    expect(textOf("1.").y).toBe(textOf("one").y);
    expect(textOf("1.").x).toBeLessThan(textOf("one").x);
    expect(textOf("2.").y).toBe(textOf("two").y);
    expect(textOf("•").y).toBe(textOf("dot").y);
    expect(
      ops.some(
        (op) =>
          op.kind === "fill" &&
          op.y > textOf("dot").y &&
          op.y < textOf("done").y + 4,
      ),
    ).toBe(true);
  });

  it("draws a table's cells in a grid, with the header row in bold", () => {
    const { ops, textOf } = recordLayout(
      "Table",
      ["| Name | Status |", "| --- | --- |", "| Signup | Ready |"].join("\n"),
    );

    expect(textOf("Name").font.bold).toBe(true);
    expect(textOf("Signup").font.bold).toBe(false);
    expect(textOf("Ready").y).toBe(textOf("Signup").y);
    expect(textOf("Ready").x).toBeGreaterThan(textOf("Signup").x);
    expect(ops.filter((op) => op.kind === "line").length).toBeGreaterThan(4);
  });

  it("keeps a code block's spacing in a monospaced font", () => {
    const { textOf } = recordLayout(
      "Code",
      ["```", "if (x) {", "  return 1;", "}", "```"].join("\n"),
    );

    expect(textOf("  return 1;").font.mono).toBe(true);
    expect(textOf("}").y).toBeGreaterThan(textOf("  return 1;").y);
  });

  it("shows an image as its caption, linked to the image", () => {
    const { ops, textOf } = recordLayout(
      "Image",
      "![A caption](https://cdn.example.com/x.png)",
    );

    expect(textOf("Image: A caption").font.italic).toBe(true);
    expect(ops).toContainEqual(
      expect.objectContaining({
        kind: "link",
        url: "https://cdn.example.com/x.png",
      }),
    );
  });
});

describe("renderDocumentPdf", () => {
  it("writes a PDF file with an embedded font, the page's links and its title", () => {
    const pdf = renderDocumentPdf({
      title: "Q3 plan",
      content:
        "Hello [site](https://example.com), Привет 👋 мир\n\n*Lean* text",
    });
    const raw = pdf.toString("latin1");

    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).toContain("/URI (https://example.com/)");
    expect(raw).toContain("/FontFile2");
    expect(raw).toContain("/Title (Q3 plan)");
    expect(raw.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
  });
});
