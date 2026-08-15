import { describe, expect, it } from "vitest";

import { convertToSlideHtml } from "./html-converter.js";
import type { ParsedElement, ParsedSlide } from "./pptx-parser.js";

/**
 * Real numbers from a portrait PDF page (10287000 x 12852400 EMU, ratio
 * 0.8) that reproduced the reported bug: a square background photo
 * rendered squashed into the top ~50% of the slide, and the title text sat
 * in the middle of the canvas instead of near the bottom.
 */
function portraitSlide(): ParsedSlide {
  const widthEmu = 10287000;
  const heightEmu = 12852400;
  const image: ParsedElement = {
    id: "img-1",
    kind: "image",
    x: -1294848,
    y: -89725,
    width: 12948475,
    height: 12948475,
  };
  return {
    texts: [],
    images: [],
    elements: [image],
    widthEmu,
    heightEmu,
  };
}

/**
 * Real numbers for a standard 13.33in x 7.5in widescreen PPTX slide
 * (12192000 x 6858000 EMU, exactly 16:9) — the common case, not an edge
 * case. `toSlidePxX`/`toSlidePxY` scale this down to the 960x540 reference
 * box; font sizes must scale by the same factor instead of a fixed pt->px
 * conversion, or every run renders larger than its box expects.
 */
function widescreenTextSlide(fontSizePt: number): ParsedSlide {
  const widthEmu = 12192000;
  const heightEmu = 6858000;
  const text: ParsedElement = {
    id: "text-1",
    kind: "text",
    x: 0,
    y: 0,
    width: widthEmu,
    height: heightEmu,
    paragraphs: [{ runs: [{ content: "Hi", fontSize: fontSizePt }] }],
  };
  return {
    texts: [],
    images: [],
    elements: [text],
    widthEmu,
    heightEmu,
  };
}

function styleAttr(html: string, dataAttr: string): string {
  const marker = `data-pptx-element-kind="${dataAttr}"`;
  const start = html.indexOf(marker);
  const styleStart = html.indexOf('style="', start) + 'style="'.length;
  const styleEnd = html.indexOf('"', styleStart);
  return html.slice(styleStart, styleEnd);
}

function pxValue(style: string, prop: string): number {
  const match = style.match(new RegExp(`${prop}:\\s*([\\d.]+)px`));
  if (!match) throw new Error(`missing ${prop} in ${style}`);
  return Number(match[1]);
}

describe("convertToSlideHtml fidelity positioning", () => {
  it("scales a portrait/non-16:9 slide's elements against its own aspect ratio, not a fixed 16:9 box", () => {
    const html = convertToSlideHtml(portraitSlide());
    const imageStyle = styleAttr(html, "image");

    const width = pxValue(imageStyle, "width");
    const height = pxValue(imageStyle, "height");

    // The source image is square in EMU (width === height): isotropic
    // scaling must keep it square in the rendered px box too.
    expect(width).toBeCloseTo(height, -1);

    // The nearest aspect-ratio preset for a 0.8 ratio slide is "4:5"
    // (864x1080) — the image should span (near) the full 1080px canvas
    // height, not the old fixed 540px reference that squashed it in half.
    expect(height).toBeGreaterThan(1000);
  });
});

describe("convertToSlideHtml fidelity text sizing", () => {
  it("scales run font size by the same EMU-relative factor as element positions", () => {
    const html = convertToSlideHtml(widescreenTextSlide(24));
    const match = html.match(/font-size:([\d.]+)px/);
    if (!match) throw new Error("missing font-size in rendered run");
    // 24pt -> 304800 EMU -> * (960 / 12192000) = 24px, not the fixed
    // 24 * 96/72 = 32px a source-size-blind pt->px conversion would give.
    expect(Number(match[1])).toBeCloseTo(24, 0);
  });

  it("defaults an undecorated slide's background to white, not black", () => {
    // A slide with no `<p:bg>` fill has no `backgroundColor` on the parsed
    // slide — PowerPoint's own default for that case is a white slide, not
    // black, and defaulting to black silently made the source's own (often
    // dark) text unreadable.
    const html = convertToSlideHtml(widescreenTextSlide(24));
    const slideStyle = html.match(
      /class="fmd-slide fmd-imported-pptx"[^>]*style="([^"]*)"/,
    )?.[1];
    if (!slideStyle) throw new Error("missing imported-pptx slide style");
    expect(slideStyle).toContain("background: #ffffff");
    // A run with no `<a:solidFill>` gets OOXML's own declared default text
    // color. An invented near-black renders as a visibly different black
    // beside the deck's real #000000 inside a single text box.
    expect(html).toContain("color:#000000");
    expect(html).not.toContain("color:#ffffff;font-weight");
  });
});

describe("convertToSlideHtml numbered bullets", () => {
  it("keeps a multi-character auto-num bullet like '2.' from wrapping onto its own line", () => {
    const widthEmu = 12192000;
    const heightEmu = 6858000;
    const text: ParsedElement = {
      id: "text-1",
      kind: "text",
      x: 0,
      y: 0,
      width: widthEmu,
      height: heightEmu,
      paragraphs: [
        {
          bulletChar: "2.",
          runs: [{ content: "Give me a button", fontSize: 19 }],
        },
      ],
    };
    const slide: ParsedSlide = {
      texts: [],
      images: [],
      elements: [text],
      widthEmu,
      heightEmu,
    };

    const html = convertToSlideHtml(slide);
    const bulletStyle = html.match(
      /<span aria-hidden="true" style="([^"]*)">2\.<\/span>/,
    )?.[1];
    if (!bulletStyle) throw new Error("missing bullet span in rendered run");

    // A hard `width` sized for one glyph (the common case, e.g. "•") wraps
    // a two-character bullet like "2." internally under the paragraph's
    // inherited `white-space:pre-wrap`, splitting the digit from the
    // period onto separate lines.
    expect(bulletStyle).not.toMatch(/(?<!min-)width:/);
    expect(bulletStyle).toContain("white-space:nowrap");
  });
});

describe("convertToSlideHtml table fidelity", () => {
  function tableSlide(): ParsedSlide {
    const widthEmu = 12192000;
    const heightEmu = 6858000;
    const table: ParsedElement = {
      id: "table-1",
      kind: "table",
      x: 100,
      y: 200,
      width: 4000,
      height: 2000,
      table: {
        rows: [
          [
            { paragraphs: [{ runs: [{ content: "A1" }] }] },
            { paragraphs: [{ runs: [{ content: "B1" }] }] },
          ],
          [
            {
              paragraphs: [{ runs: [{ content: "Merged" }] }],
              colSpan: 2,
              fill: "#112233",
            },
          ],
        ],
        columnWidthsEmu: [1000, 3000],
        rowHeightsEmu: [500, 1500],
      },
    };
    return {
      texts: [],
      images: [],
      elements: [table],
      widthEmu,
      heightEmu,
    };
  }

  it("renders a table element as a real <table> with cell content and spans, not empty or dropped", () => {
    const html = convertToSlideHtml(tableSlide());

    expect(html).toContain('data-pptx-element-kind="table"');
    expect(html).toContain("<table");
    expect(html).toContain(">A1<");
    expect(html).toContain(">B1<");
    expect(html).toContain('colspan="2"');
    expect(html).toContain(">Merged<");
    expect(html).toContain("background:#112233");
    expect(html).toContain('<col style="width:25%" />');
    expect(html).toContain('<col style="width:75%" />');
    expect(html).toContain('<tr style="height:25%">');
    expect(html).toContain('<tr style="height:75%">');
  });

  it("does not stamp an invented cell border, and pads cells with the format's own default margins", () => {
    const html = convertToSlideHtml(tableSlide());
    // A fixed light border is invisible on the white slides these tables
    // usually sit on and draws a grid the source never declared on dark
    // ones — the parser reads no `a:tcPr` line properties, so there is
    // nothing to reproduce.
    expect(html).not.toContain("rgba(255,255,255,0.25)");
    expect(html).not.toMatch(/<td[^>]*border:/);
    // 0.05in top/bottom, 0.1in left/right, scaled by this slide's own
    // canvas: 12192000 EMU -> 960px.
    expect(html).toContain("padding:3.6px 7.2px");
  });
});
