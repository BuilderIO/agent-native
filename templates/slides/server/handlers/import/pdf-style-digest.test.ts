import { describe, expect, it } from "vitest";

import type { PdfFidelityPage } from "./pdf-fidelity-parser.js";
import { buildPdfStyleDigest } from "./pdf-style-digest.js";

const EMU_PER_POINT = 12700;
const pt = (value: number) => value * EMU_PER_POINT;

function textElement(args: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  runs: Array<{
    content: string;
    fontSize?: number;
    fontFamily?: string;
    bold?: boolean;
    color?: string;
  }>;
  alignment?: "left" | "center" | "right" | "justify";
}): PdfFidelityPage["elements"][number] {
  return {
    id: args.id,
    kind: "text",
    x: pt(args.x),
    y: pt(args.y),
    width: pt(args.width),
    height: pt(args.height),
    paragraphs: [
      {
        runs: args.runs,
        ...(args.alignment ? { alignment: args.alignment } : {}),
      },
    ],
  };
}

function page(overrides: Partial<PdfFidelityPage> = {}): PdfFidelityPage {
  return {
    pageNumber: 1,
    widthEmu: pt(720),
    heightEmu: pt(405),
    backgroundColor: undefined,
    elements: [],
    imagesSkipped: 0,
    ...overrides,
  };
}

describe("buildPdfStyleDigest", () => {
  it("returns null when the parse produced no pages", () => {
    expect(buildPdfStyleDigest([])).toBeNull();
  });

  it("reports geometry for a page with no text instead of failing", () => {
    const digest = buildPdfStyleDigest([page()]);

    expect(digest).not.toBeNull();
    expect(digest?.pageWidthPt).toBe(720);
    expect(digest?.orientation).toBe("landscape");
    expect(digest?.aspectRatio).toBe(1.778);
    expect(digest?.typeScale).toEqual([]);
    expect(digest?.textMarginsPt).toBeNull();
  });

  it("ranks the type scale by how much of the document uses it", () => {
    const digest = buildPdfStyleDigest([
      page({
        elements: [
          textElement({
            id: "a",
            x: 64,
            y: 48,
            width: 500,
            height: 60,
            runs: [
              {
                content: "Quarterly review",
                fontSize: 44,
                fontFamily: "Sohne",
                bold: true,
                color: "#ffffff",
              },
            ],
            alignment: "left",
          }),
          textElement({
            id: "b",
            x: 64,
            y: 140,
            width: 500,
            height: 120,
            runs: [
              { content: "Body one", fontSize: 18, fontFamily: "Sohne" },
              { content: "Body two", fontSize: 18, fontFamily: "Sohne" },
              { content: "Body three", fontSize: 18, fontFamily: "Sohne" },
            ],
            alignment: "left",
          }),
        ],
      }),
    ]);

    expect(digest?.typeScale[0]).toMatchObject({
      fontSizePt: 18,
      fontFamily: "Sohne",
      bold: false,
      runCount: 3,
    });
    expect(digest?.typeScale[1]).toMatchObject({
      fontSizePt: 44,
      bold: true,
      color: "#ffffff",
      runCount: 1,
      sample: "Quarterly review",
    });
    expect(digest?.paragraphAlignments).toEqual([
      { alignment: "left", blockCount: 2 },
    ]);
  });

  it("counts painted backgrounds across pages and measures text margins", () => {
    const withText = (pageNumber: number, backgroundColor?: string) =>
      page({
        pageNumber,
        backgroundColor,
        elements: [
          textElement({
            id: `t-${pageNumber}`,
            x: 60,
            y: 40,
            width: 600,
            height: 300,
            runs: [{ content: "Body", fontSize: 18 }],
          }),
        ],
      });

    const digest = buildPdfStyleDigest([
      withText(1, "#101828"),
      withText(2, "#101828"),
      withText(3),
    ]);

    expect(digest?.backgroundColors).toEqual([
      { color: "#101828", pageCount: 2 },
    ]);
    expect(digest?.textMarginsPt).toEqual({
      left: 60,
      right: 60,
      top: 40,
      bottom: 65,
    });
    expect(digest?.pageCount).toBe(3);
  });

  it("counts pages carrying imagery", () => {
    const digest = buildPdfStyleDigest([
      page({
        elements: [
          {
            id: "img",
            kind: "image",
            x: 0,
            y: 0,
            width: pt(720),
            height: pt(405),
          },
        ],
      }),
      page({ pageNumber: 2 }),
    ]);

    expect(digest?.pagesWithImages).toBe(1);
  });

  it("counts imagery the read-only parse detected but could not place", () => {
    const digest = buildPdfStyleDigest([
      page({ imagesSkipped: 3 }),
      page({ pageNumber: 2, imagesSkipped: 1 }),
      page({ pageNumber: 3 }),
    ]);

    expect(digest?.pagesWithImages).toBe(2);
  });

  it("classifies a portrait reference", () => {
    const digest = buildPdfStyleDigest([
      page({ widthEmu: pt(612), heightEmu: pt(792) }),
    ]);

    expect(digest?.orientation).toBe("portrait");
  });
});
