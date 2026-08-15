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

/** One shape on a standard 13.33in x 7.5in widescreen slide (960x540 reference box). */
function shapeSlide(shape: Partial<ParsedElement>): ParsedSlide {
  const widthEmu = 12192000;
  const heightEmu = 6858000;
  return {
    texts: [],
    images: [],
    elements: [
      {
        id: "shape-1",
        kind: "shape",
        x: 0,
        y: 0,
        width: 1219200,
        height: 1219200,
        ...shape,
      } as ParsedElement,
    ],
    widthEmu,
    heightEmu,
  };
}

describe("convertToSlideHtml shape geometry", () => {
  it("renders an ellipse as a round shape, not a square", () => {
    const style = styleAttr(
      convertToSlideHtml(shapeSlide({ shapeType: "ellipse", fill: "#ff0000" })),
      "shape",
    );
    expect(style).toContain("border-radius: 50%");
    expect(style).toContain("background: #ff0000");
  });

  it("rounds a roundRect by PowerPoint's own default adjustment, not a fixed 6px", () => {
    // 1219200 EMU -> 96px; PowerPoint's default roundRect adj is 16.667% of
    // the shortest side, so a 95x95px card's real radius is ~16px.
    const style = styleAttr(
      convertToSlideHtml(shapeSlide({ shapeType: "roundRect" })),
      "shape",
    );
    const radius = Number(style.match(/border-radius: ([\d.]+)px/)?.[1]);
    expect(radius).toBeCloseTo(96 * 0.16667, 1);
  });

  it("clips polygonal presets instead of leaving them as their bounding rectangle", () => {
    for (const shapeType of [
      "triangle",
      "rtTriangle",
      "hexagon",
      "chevron",
      "homePlate",
      "trapezoid",
      "parallelogram",
      "downArrow",
      "rightArrow",
    ]) {
      const style = styleAttr(
        convertToSlideHtml(shapeSlide({ shapeType, fill: "#ff0000" })),
        "shape",
      );
      expect(style, shapeType).toContain("clip-path: polygon(");
    }
    const triangle = styleAttr(
      convertToSlideHtml(shapeSlide({ shapeType: "triangle" })),
      "shape",
    );
    expect(triangle).toContain(
      "clip-path: polygon(50% 0%, 100% 100%, 0% 100%)",
    );
  });

  it("paints nothing for a geometry whose real outline is mostly empty space", () => {
    // A blockArc ring or a halfFrame L-bracket is over 90% transparent.
    // Filling its bounding box covers the neighbouring content the real
    // geometry leaves visible — four concentric rings become one opaque
    // square over the slide title.
    for (const shapeType of ["blockArc", "halfFrame", "uturnArrow", "donut"]) {
      const style = styleAttr(
        convertToSlideHtml(
          shapeSlide({ shapeType, fill: "#ff0000", lineColor: "#00ff00" }),
        ),
        "shape",
      );
      expect(style, shapeType).not.toContain("background:");
      expect(style, shapeType).not.toContain("solid");
    }
  });
});

describe("convertToSlideHtml stroke geometry", () => {
  it("draws a zero-height rule as a single edge at its authored weight, not a four-sided border", () => {
    // A 2.25pt horizontal rule: the `border` shorthand paints the top *and*
    // bottom edges of the zero-height box, drawing 6px of line instead of 3px
    // and growing left/right nubs the source never had.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          height: 0,
          width: 3048000,
          lineColor: "#595959",
          lineWidth: 28575,
        }),
      ),
      "shape",
    );
    expect(style).toContain("border-top: 2.25px solid #595959");
    expect(style).not.toMatch(/(?<!-)border: /);
  });

  it("draws a zero-width rule as a single left edge so it is not longer than authored", () => {
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          width: 0,
          height: 921544,
          lineColor: "#000000",
          lineWidth: 19050,
        }),
      ),
      "shape",
    );
    expect(style).toContain("border-left: 1.5px solid #000000");
    expect(style).not.toMatch(/(?<!-)border: /);
  });

  it("treats a hairline thinner than its own two borders as a line too", () => {
    // A 1.638px-wide, 200px-tall rule (a real one, from an imported deck):
    // its left and right 1px borders already overlap, so the shorthand can
    // only ever draw a doubled line, never an outlined box.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          width: 20802,
          height: 2536825,
          lineColor: "#595959",
          lineWidth: 12700,
        }),
      ),
      "shape",
    );
    expect(style).toContain("border-left: 1px solid #595959");
    expect(style).not.toMatch(/(?<!-)border: /);
  });

  it("keeps a real four-sided border on a box with both dimensions", () => {
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({ lineColor: "#000000", lineWidth: 12700 }),
      ),
      "shape",
    );
    expect(style).toContain("border: 1px solid #000000");
  });
});

describe("convertToSlideHtml font families", () => {
  it("falls back to the base family for a PowerPoint weight-variant typeface name", () => {
    const widthEmu = 12192000;
    const html = convertToSlideHtml({
      texts: [],
      images: [],
      elements: [
        {
          id: "text-1",
          kind: "text",
          x: 0,
          y: 0,
          width: widthEmu,
          height: 6858000,
          paragraphs: [
            {
              runs: [
                { content: "Hi", fontSize: 14, fontFamily: "Work Sans Medium" },
              ],
            },
          ],
        },
      ],
      widthEmu,
      heightEmu: 6858000,
    });
    // No webfont registers "Work Sans Medium" as a family, so a raw
    // pass-through always falls back to sans-serif even when Work Sans is
    // loaded. The exact name stays first for the deck that really does ship
    // the variant family.
    expect(html).toContain(
      "font-family:'Work Sans Medium', 'Work Sans', sans-serif",
    );
    expect(html).toContain("font-weight:500");
  });

  it("maps a Black typeface name to weight 900 instead of regular", () => {
    const widthEmu = 12192000;
    const html = convertToSlideHtml({
      texts: [],
      images: [],
      elements: [
        {
          id: "text-1",
          kind: "text",
          x: 0,
          y: 0,
          width: widthEmu,
          height: 6858000,
          paragraphs: [
            {
              runs: [
                { content: "Hi", fontSize: 14, fontFamily: "Roboto Black" },
              ],
            },
          ],
        },
      ],
      widthEmu,
      heightEmu: 6858000,
    });
    expect(html).toContain("font-family:'Roboto Black', 'Roboto', sans-serif");
    expect(html).toContain("font-weight:900");
  });
});

describe("convertToSlideHtml empty slides", () => {
  it("renders a zero-element slide as its own declared background, not an invented title", () => {
    // A deliberate full-bleed divider slide has an empty `<p:spTree>`. The
    // title template invents copy that appears nowhere in the source and
    // drops the background the slide states explicitly.
    const html = convertToSlideHtml({
      texts: [],
      images: [],
      elements: [],
      widthEmu: 12192000,
      heightEmu: 6858000,
      backgroundColor: "#242424",
    });
    expect(html).not.toContain("Untitled Slide");
    expect(html).toContain("background: #242424");
    expect(html).toContain('data-imported-pptx="true"');
    expect(html).toContain('data-slide-width-emu="12192000"');
  });
});

describe("convertToSlideHtml paragraph defaults", () => {
  function paragraphSlide(
    paragraphs: ParsedElement["paragraphs"],
  ): ParsedSlide {
    const widthEmu = 12192000;
    return {
      texts: [],
      images: [],
      elements: [
        {
          id: "text-1",
          kind: "text",
          x: 0,
          y: 0,
          width: widthEmu,
          height: 6858000,
          paragraphs,
        },
      ],
      widthEmu,
      heightEmu: 6858000,
    };
  }

  it("single-spaces a paragraph that declares no line spacing, matching a declared 100%", () => {
    const declared = convertToSlideHtml(
      paragraphSlide([
        { runs: [{ content: "Hi", fontSize: 14 }], lineSpacing: 1 },
      ]),
    );
    const inherited = convertToSlideHtml(
      paragraphSlide([{ runs: [{ content: "Hi", fontSize: 14 }] }]),
    );
    const lineHeight = (html: string) =>
      html.match(/line-height:([\d.]+)/)?.[1];
    expect(lineHeight(inherited)).toBe(lineHeight(declared));
    expect(lineHeight(inherited)).toBe("1");
  });

  it("sizes a blank spacer paragraph from its own text box, not the format-wide default", () => {
    const html = convertToSlideHtml(
      paragraphSlide([
        { runs: [{ content: "Body copy", fontSize: 14 }] },
        { runs: [] },
      ]),
    );
    // 14pt -> 14px in this slide's 960px reference box. An 18pt fallback
    // would reserve 24px for an empty line inside a 14pt box, and every
    // blank paragraph would push the copy below it further down.
    const blank = html.match(/data-pptx-paragraph="1" style="([^"]*)"/)?.[1];
    if (!blank) throw new Error("missing blank paragraph");
    expect(blank).toContain("font-size:14px");
    expect(blank).toContain("min-height:14px");
  });
});
