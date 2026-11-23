import { describe, expect, it } from "vitest";

import {
  layoutDocumentPdf,
  PDF_MAX_PAGES,
  PdfTooLongError,
  PdfUnsupportedTextError,
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
  | { kind: "fill"; page: number; y: number; height: number; color: Rgb }
  | { kind: "link"; page: number; url: string };

function tooLongReason(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof PdfTooLongError) return error.reason;
    throw error;
  }
  return undefined;
}

function recordLayout(title: string, content: string) {
  const ops: Op[] = [];
  let page = 1;
  let pageCount = 1;
  let measured = 0;
  const measure = (text: string, font: PdfFont) => {
    measured += text.length;
    return text.length * font.size * 0.5;
  };
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
    fill: (_x, y, _width, height, color) => {
      ops.push({ kind: "fill", page, y, height, color });
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
  return { ops, texts, textOf, pageCount, measure, measured };
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

  it("prints the page title as written, not as Markdown", () => {
    const { textOf } = recordLayout("Report **literal**", "Body");

    expect(textOf("Report **literal**").font.bold).toBe(true);
  });

  it("doesn't repeat a title the page already opens with", () => {
    const { texts } = recordLayout("Plan", "# Plan\n\nBody");

    expect(texts.filter((op) => op.text === "Plan")).toHaveLength(1);
  });

  it("shows a toggle's title, with its body indented under it", () => {
    const tab = String.fromCharCode(9);
    const { textOf } = recordLayout(
      "Toggles",
      [
        "<details open>",
        "<summary>Toggle title</summary>",
        tab + "First paragraph",
        tab + "Second paragraph",
        "</details>",
      ].join("\n"),
    );

    expect(textOf("Toggle title").x).toBeLessThan(textOf("First paragraph").x);
    expect(textOf("Second paragraph").y).toBeGreaterThan(
      textOf("First paragraph").y,
    );
  });

  it("keeps list numbers, leading spaces and deep indents inside the margins", () => {
    const tab = String.fromCharCode(9);
    const { texts, measure } = recordLayout(
      "Margins",
      [
        "9. Nine",
        "10. Ten",
        "",
        "a<br>" + " ".repeat(200) + "b",
        "",
        tab.repeat(29) + "deep",
      ].join("\n"),
    );

    for (const op of texts) {
      expect(op.x).toBeGreaterThanOrEqual(54);
      expect(op.x + measure(op.text, op.font)).toBeLessThanOrEqual(612 - 54);
    }
    expect(texts.map((op) => op.text)).toEqual(
      expect.arrayContaining(["10.", "b", "deep"]),
    );
  });

  it("keeps a run of headings on the page with the text after them", () => {
    for (let leads = 20; leads <= 40; leads++) {
      const { textOf } = recordLayout(
        "Title",
        [
          ...Array.from({ length: leads }, () => "Lead"),
          "## Heading",
          "# Following",
          "Body",
        ].join("\n\n"),
      );

      expect(textOf("Following").page).toBe(textOf("Heading").page);
      expect(textOf("Body").page).toBe(textOf("Heading").page);
    }
  });

  it("starts a callout's bar beside its first line", () => {
    const tab = String.fromCharCode(9);
    for (let leads = 20; leads <= 40; leads++) {
      const { ops, textOf } = recordLayout(
        "Title",
        [
          ...Array.from({ length: leads }, () => "Lead"),
          "<callout>",
          tab + "## Heading",
          tab + "body",
          "</callout>",
        ].join("\n\n"),
      );

      const pages = new Set([textOf("Heading").page, textOf("body").page]);
      const barPages = ops.flatMap((op) =>
        op.kind === "line" && op.y1 !== op.y2 ? [op.page] : [],
      );
      expect(barPages.length).toBeGreaterThan(0);
      expect(barPages.filter((page) => !pages.has(page))).toEqual([]);
    }
  });

  it("keeps code and table backgrounds and borders above the bottom margin", () => {
    for (let leads = 0; leads <= 30; leads += 3) {
      const leadText = Array.from({ length: leads }, () => "Lead");
      const { ops } = recordLayout(
        "Title",
        [
          ...leadText,
          ["~~~", ...Array.from({ length: 46 }, () => "X"), "~~~"].join("\n"),
          "| " + Array.from({ length: 40 }, () => "X").join("<br>") + " |",
          "| --- |",
          "| y |",
        ].join("\n\n"),
      );

      const lowest = Math.max(
        ...ops.map((op) =>
          op.kind === "fill"
            ? op.y + op.height
            : op.kind === "line"
              ? Math.max(op.y1, op.y2)
              : 0,
        ),
      );
      expect(lowest).toBeLessThanOrEqual(792 - 54 + 0.001);
    }
  });

  it("measures a long code line a character at a time", () => {
    const { measured } = recordLayout(
      "Code",
      ["~~~", "x".repeat(4000), "~~~"].join("\n"),
    );

    expect(measured).toBeLessThan(4000 * 3);
  });

  it("keeps a heading with a following heading that wraps onto two lines", () => {
    const wrapped = Array.from({ length: 10 }, () => "wrapped").join(" ");
    for (let leads = 18; leads <= 32; leads++) {
      const { textOf } = recordLayout(
        "Title",
        [
          ...Array.from({ length: leads }, () => "Lead"),
          "## First",
          "# " + wrapped,
          "Body",
        ].join("\n\n"),
      );

      expect(textOf("Body").page).toBe(textOf("First").page);
    }
  });

  it("starts a callout's bar beside a code block that opens it", () => {
    const tab = String.fromCharCode(9);
    for (let leads = 20; leads <= 40; leads++) {
      const { ops, textOf } = recordLayout(
        "Title",
        [
          ...Array.from({ length: leads }, () => "Lead"),
          ["<callout>", tab + "~~~", tab + "x", tab + "~~~", "</callout>"].join(
            "\n",
          ),
        ].join("\n\n"),
      );

      const barPages = ops.flatMap((op) =>
        op.kind === "line" && op.y1 !== op.y2 ? [op.page] : [],
      );
      expect(barPages.length).toBeGreaterThan(0);
      expect(barPages.filter((page) => page !== textOf("x").page)).toEqual([]);
    }
  });

  it("keeps deeply nested lists with wide numbers inside the page", () => {
    const tab = String.fromCharCode(9);
    const { texts, measure } = recordLayout(
      "Nested",
      Array.from(
        { length: 15 },
        (_, level) => tab.repeat(level) + "10000. Item",
      ).join("\n"),
    );

    expect(texts.filter((op) => op.text === "10000.")).toHaveLength(15);
    for (const op of texts) {
      expect(op.x).toBeGreaterThanOrEqual(54);
      expect(op.x + measure(op.text, op.font)).toBeLessThanOrEqual(612 - 54);
    }
  });

  it("keeps text nested in many toggles inside the page", () => {
    const tab = String.fromCharCode(9);
    const toggles = (depth: number): string[] =>
      depth === 0
        ? ["deep text"]
        : [
            "<details open>",
            "<summary>Level " + depth + "</summary>",
            ...toggles(depth - 1).map((line) => tab + line),
            "</details>",
          ];
    const { texts, measure } = recordLayout("Toggles", toggles(30).join("\n"));

    expect(texts.map((op) => op.text)).toContain("deep text");
    for (const op of texts) {
      expect(op.x).toBeGreaterThanOrEqual(54);
      expect(op.x + measure(op.text, op.font)).toBeLessThanOrEqual(612 - 54);
    }
  });

  it("keeps room for an indented paragraph deep in toggles", () => {
    const tab = String.fromCharCode(9);
    const toggles = (depth: number): string[] =>
      depth === 0
        ? [tab.repeat(3) + "deep text"]
        : [
            "<details open>",
            "<summary>Level " + depth + "</summary>",
            ...toggles(depth - 1).map((line) => tab + line),
            "</details>",
          ];
    const { texts, measure } = recordLayout("Toggles", toggles(30).join("\n"));

    expect(texts.map((op) => op.text)).toContain("deep text");
    for (const op of texts) {
      expect(op.x).toBeGreaterThanOrEqual(54);
      expect(op.x + measure(op.text, op.font)).toBeLessThanOrEqual(612 - 54);
    }
  });

  it("doesn't add a blank line for spaces before a line break", () => {
    const plain = recordLayout("Spaces", "a<br>b");
    const spaced = recordLayout("Spaces", "a" + " ".repeat(200) + "<br>b");

    expect(spaced.textOf("b").y - spaced.textOf("a").y).toBe(
      plain.textOf("b").y - plain.textOf("a").y,
    );
  });

  it("matches the title against an opening heading typed with a combining accent", () => {
    const accent = String.fromCharCode(0x301);
    const { texts } = recordLayout("Café", "# Cafe" + accent + "\n\nBody");

    expect(
      texts.filter((op) => op.text.normalize("NFC") === "Café"),
    ).toHaveLength(1);
  });

  it("stops at the PDF page limit instead of laying out a longer page", () => {
    const paragraphs = (count: number) =>
      Array.from({ length: count }, (_, index) => `Paragraph ${index}`).join(
        "\n\n",
      );
    const { pageCount } = recordLayout("Long", paragraphs(5000));

    expect(pageCount).toBeGreaterThan(PDF_MAX_PAGES / 2);
    expect(pageCount).toBeLessThan(PDF_MAX_PAGES);
    expect(tooLongReason(() => recordLayout("Long", paragraphs(20_000)))).toBe(
      "pages",
    );
  });

  it("refuses a table whose columns are too narrow for text, even with empty cells", () => {
    const row = (columns: number, cell: string) =>
      `| ${Array.from({ length: columns }, () => cell).join(" | ")} |`;
    const table = (columns: number) =>
      [
        row(columns, "h"),
        row(columns, "---"),
        ...Array.from({ length: 20 }, () => row(columns, " ")),
      ].join("\n");

    expect(() => recordLayout("Wide", table(22))).not.toThrow();
    expect(tooLongReason(() => recordLayout("Wide", table(23)))).toBe("table");
    expect(tooLongReason(() => recordLayout("Wide", table(400)))).toBe("table");
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

  it("leaves out emoji and symbols the font lacks, and keeps the rest", () => {
    expect(() =>
      renderDocumentPdf({
        title: "Symbols",
        content: "Done ✓ 👋🏽 1️⃣ → © — café",
      }),
    ).not.toThrow();
  });

  it("refuses text in scripts the font can't show", () => {
    for (const content of ["before 中文 after", "שלום", "مرحبا", "हिन्दी"]) {
      expect(() => renderDocumentPdf({ title: "Scripts", content })).toThrow(
        PdfUnsupportedTextError,
      );
    }
    expect(() => renderDocumentPdf({ title: "中文", content: "Body" })).toThrow(
      PdfUnsupportedTextError,
    );
  });

  it("draws a letter typed with a combining accent, in prose, code and long words", () => {
    const word = "cafe" + String.fromCharCode(0x301);
    expect(() =>
      renderDocumentPdf({
        title: "Accents",
        content: [
          word + " and `" + word + "`",
          ["~~~", word, "~~~"].join("\n"),
          word.repeat(40),
        ].join("\n\n"),
      }),
    ).not.toThrow();
  });

  it("stops drawing a table of narrow cells at the text limit, before the page limit", () => {
    const row = (cell: string) =>
      `| ${Array.from({ length: 20 }, () => cell).join(" | ")} |`;
    const table = [
      row("head"),
      row("---"),
      ...Array.from({ length: 900 }, () => row("abcdefghijklmnopqrstuvwx")),
    ].join("\n");
    const { pageCount } = recordLayout("Narrow", table);

    expect(pageCount).toBeLessThan(PDF_MAX_PAGES);
    expect(
      tooLongReason(() =>
        renderDocumentPdf({ title: "Narrow", content: table }),
      ),
    ).toBe("text");
  });
});
