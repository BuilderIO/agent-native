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
    // A border is drawn only where the source declares one. A fixed light
    // rule is invisible on the white slides these tables usually sit on and
    // draws a grid the source never had on dark ones.
    expect(html).not.toContain("rgba(255,255,255,0.25)");
    expect(html).not.toMatch(/<td[^>]*border/);
    // 0.05in top/bottom, 0.1in left/right, scaled by this slide's own
    // canvas: 12192000 EMU -> 960px.
    expect(html).toContain("padding:3.6px 7.2px");
  });

  it("draws each declared cell edge as its own border-* rule so the grid reads as a table", () => {
    const slide = tableSlide();
    const rows = slide.elements[0]?.table?.rows;
    if (!rows) throw new Error("missing table rows");
    rows[0][0].borders = {
      left: { color: "#111111", widthEmu: 19050 },
      top: { color: "#111111", widthEmu: 19050 },
      right: { color: "#9E9E9E", widthEmu: 9525 },
      bottom: { color: "#9E9E9E", widthEmu: 9525, dash: "dashed" },
    };

    const html = convertToSlideHtml(slide);
    const cellFor = (text: string) =>
      html.split("<td").find((chunk) => chunk.includes(`>${text}<`));
    const cell = cellFor("A1");
    if (!cell) throw new Error("missing A1 cell in rendered table");

    expect(cell).toContain("border-left:1.5px solid #111111;");
    expect(cell).toContain("border-top:1.5px solid #111111;");
    // A 0.75pt hairline scales to 0.75px on the reference canvas, which the
    // browser can round away entirely — the floor keeps the rule visible.
    expect(cell).toContain("border-right:1px solid #9E9E9E;");
    expect(cell).toContain("border-bottom:1px dashed #9E9E9E;");
    // Collapsed borders, or every interior rule doubles against its
    // neighbour's.
    expect(html).toContain("border-collapse:collapse");
    // A cell with no declared edges still gets none, so it yields to its
    // neighbour's rule instead of erasing it.
    expect(cellFor("Merged")?.split(">")[0]).not.toContain("border");
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
    // A donut ring or a bracket pair is over 90% transparent. Filling its
    // bounding box covers the neighbouring content the real geometry leaves
    // visible — four concentric rings become one opaque square over the slide
    // title.
    for (const shapeType of [
      "donut",
      "frame",
      "bracketPair",
      "curvedUpArrow",
    ]) {
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

  it("draws a blockArc as the ring segment its own adjustments describe", () => {
    // Real values from a six-segment ring diagram: 146.4deg to 201.7deg, ring
    // thickness 22.427% of the shortest side. Reproducing the preset from its
    // defaults instead would draw all six segments as the same half-ring.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          shapeType: "blockArc",
          fill: "#fecf4f",
          shapeAdjustments: { adj1: 8786043, adj2: 12102207, adj3: 22427 },
        }),
      ),
      "shape",
    );
    // 96x96px box: outer radius 48, inner 48 - 96*0.22427 = 26.5, and the
    // four corners are (48 + r*cos a, 48 + r*sin a) at 146.434deg/201.703deg.
    expect(style).toContain("clip-path: path('M8 74.5 A48 48 0 0 1 3.4 30.2");
    expect(style).toContain("A26.5 26.5 0 0 0 25.9 62.6 Z')");
    expect(style).toContain("background: #fecf4f");
  });

  it("keeps a blockArc's default half-ring when the deck declares no adjustments", () => {
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({ shapeType: "blockArc", fill: "#ff0000" }),
      ),
      "shape",
    );
    // PowerPoint's defaults are adj1=180deg, adj2=0deg: a half ring swept
    // clockwise from the left edge back to the right.
    expect(style).toContain("clip-path: path('M0 48 A48 48 0 0 1 96 48");
  });

  it("draws a uturnArrow's two runs, bend and head instead of dropping the shape", () => {
    // Real values from the six-stage serpentine ribbon on an infographics
    // deck, where all six arrows were absent: 21.237% shaft, 19.892% half
    // head width, 23.925% head length, and a bend clamped down to the widest
    // the box allows. The preset's own defaults would draw a fatter arrow with
    // its head stopping three quarters of the way down the box.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          shapeType: "uturnArrow",
          fill: "#ff6b35",
          shapeAdjustments: {
            adj1: 21237,
            adj2: 19892,
            adj3: 23925,
            adj4: 75000,
            adj5: 100000,
          },
        }),
      ),
      "shape",
    );
    // 96x96px box. The outward run climbs the left edge to the 43.5px bend
    // radius, turns over the top, and comes back down the right to y4=73.
    expect(style).toContain(
      "clip-path: path('M0 96 L0 43.5 A43.5 43.5 0 0 1 43.5 0",
    );
    // The head: base from the right edge across to x6, tip on the bottom edge.
    expect(style).toContain("L96 73 L76.9 96 L57.8 73");
    // The inner outline returns along two quarter bends of the smaller radius.
    expect(style).toContain("A23.2 23.2 0 0 0 20.4 43.5 L20.4 96 Z')");
    expect(style).toContain("background: #ff6b35");
  });

  it("mirrors a flipped uturnArrow's outline rather than its text box", () => {
    // Three of the six ribbon arrows carry flipH with a 180deg rotation. The
    // rotation is a CSS transform, so the mirror has to live in the path — put
    // it in the transform too and every glyph in the box reads backwards.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          shapeType: "uturnArrow",
          flipH: true,
          fill: "#ff6b35",
          shapeAdjustments: {
            adj1: 21237,
            adj2: 19892,
            adj3: 23925,
            adj4: 75000,
            adj5: 100000,
          },
        }),
      ),
      "shape",
    );
    expect(style).toContain("clip-path: path('M96 96 L96 43.5");
    // The head tip mirrors from x=76.9 to x=19.1, and the bend sweeps the
    // other way.
    expect(style).toContain("L0 73 L19.1 96 L38.2 73");
    expect(style).toContain("A43.5 43.5 0 0 0 52.5 0");
  });

  it("draws a bentArrow's corner bend and head", () => {
    // 25% shaft, 19.072% half head width, 25% head length, 43.75% bend.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          shapeType: "bentArrow",
          fill: "#0f766e",
          shapeAdjustments: {
            adj1: 25000,
            adj2: 19072,
            adj3: 25000,
            adj4: 43750,
          },
        }),
      ),
      "shape",
    );
    expect(style).toContain(
      "clip-path: path('M0 96 L0 48.3 A42 42 0 0 1 42 6.3",
    );
    // Head base at x4=72, tip on the right edge at aw2=18.3.
    expect(style).toContain("L72 0 L96 18.3 L72 36.6");
  });

  it("draws a halfFrame as the mitred L-bracket its adjustments describe", () => {
    // Real values from a title slide's corner rule: a 13.198% top arm and a
    // 12.863% left arm. Filling the bounding box instead covered the title.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          shapeType: "halfFrame",
          fill: "#111111",
          shapeAdjustments: { adj1: 12863, adj2: 13198 },
        }),
      ),
      "shape",
    );
    expect(style).toContain(
      "clip-path: polygon(0% 0%, 100% 0%, 87.14% 12.86%, 13.2% 12.86%, 13.2% 86.8%, 0% 100%)",
    );
    expect(style).toContain("background: #111111");
  });

  it("draws a heart's two lobes, which no adjustment can change", () => {
    const style = styleAttr(
      convertToSlideHtml(shapeSlide({ shapeType: "heart", fill: "#e11d48" })),
      "shape",
    );
    // Control points reach outside the 96x96 box on purpose: that overhang is
    // what rounds the lobes.
    expect(style).toContain(
      "clip-path: path('M48 24 C68 -32 146 24 48 96 C-50 24 28 -32 48 24 Z')",
    );
  });

  it("draws a pie as the slice between its two angles", () => {
    // 279.14deg to 270deg wraps forward a full turn: a 350.86deg slice with a
    // narrow wedge missing, not an empty one.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          shapeType: "pie",
          fill: "#2563eb",
          shapeAdjustments: { adj1: 16748208, adj2: 16200000 },
        }),
      ),
      "shape",
    );
    expect(style).toContain(
      "clip-path: path('M55.6 0.6 A48 48 0 1 1 48 0 L48 48 Z')",
    );
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

  it("strokes a clipped preset along its outline instead of bordering the box the clip removes", () => {
    // The two TAM/SAM/SOM pyramids on a real pitch deck: `prstGeom triangle`,
    // `a:noFill`, and a 0.75pt blue line. A `border` paints the bounding box's
    // four edges and the clip then eats every part of them outside the
    // triangle, so both shapes vanished from the import entirely.
    const html = convertToSlideHtml(
      shapeSlide({ shapeType: "triangle", lineColor: "#0000FF" }),
    );
    const style = styleAttr(html, "shape");
    expect(style).not.toMatch(/border/);
    expect(style).toContain("clip-path: polygon(50% 0%, 100% 100%, 0% 100%)");
    expect(html).toContain(
      '<path d="M48 0 L96 96 L0 96 Z" fill="none" stroke="#0000FF"',
    );
  });

  it("keeps a border on a preset the renderer draws with radii rather than a clip", () => {
    // `border-radius` follows the border, so an ellipse or a roundRect has no
    // reason to pay for an SVG overlay.
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          shapeType: "ellipse",
          lineColor: "#000000",
          lineWidth: 12700,
        }),
      ),
      "shape",
    );
    expect(style).toContain("border: 1px solid #000000");
    expect(style).toContain("border-radius: 50%");
  });
});

/** One picture on a standard widescreen slide, in a 96x96px box. */
function imageSlide(image: Partial<ParsedElement>): ParsedSlide {
  return {
    texts: [],
    images: [],
    elements: [
      {
        id: "image-1",
        kind: "image",
        x: 0,
        y: 0,
        width: 1219200,
        height: 1219200,
        ...image,
      } as ParsedElement,
    ],
    widthEmu: 12192000,
    heightEmu: 6858000,
  };
}

describe("convertToSlideHtml picture geometry", () => {
  it("clips a picture to its shape, so a portrait in an ellipse frame is a circle", () => {
    // Real shape of a `p:pic` on an imported deck: `prstGeom prst="ellipse"`
    // around a cropped portrait. PowerPoint paints the picture inside that
    // geometry; rendering the bounding box gives a hard square instead.
    const style = styleAttr(
      convertToSlideHtml(imageSlide({ shapeType: "ellipse" })),
      "image",
    );
    expect(style).toContain("border-radius: 50%");
  });

  it("clips a picture to a custGeom outline too", () => {
    const style = styleAttr(
      convertToSlideHtml(imageSlide({ geometry: freeformGeometry() })),
      "image",
    );
    expect(style).toContain("clip-path: path(");
  });

  it("leaves a plain rectangular picture unclipped", () => {
    const style = styleAttr(
      convertToSlideHtml(imageSlide({ shapeType: "rect" })),
      "image",
    );
    expect(style).not.toContain("clip-path");
    expect(style).not.toContain("border-radius");
  });
});

/**
 * `shapeSlide`'s 1219200 EMU box lands on 96x96px, so a 200x100 path space
 * scales by 0.48 in x and 0.96 in y — every expected coordinate below is that
 * arithmetic, not a recorded snapshot.
 */
function freeformGeometry(): ParsedElement["geometry"] {
  return {
    kind: "custom",
    paths: [
      {
        w: 200,
        h: 100,
        commands: [
          { kind: "moveTo", points: [{ x: 0, y: 0 }] },
          { kind: "lnTo", points: [{ x: 200, y: 0 }] },
          {
            kind: "cubicBezTo",
            points: [
              { x: 180, y: 40 },
              { x: 120, y: 80 },
              { x: 60, y: 100 },
            ],
          },
          { kind: "close" },
        ],
      },
    ],
  };
}

describe("convertToSlideHtml custom geometry", () => {
  it("clips a freeform outline to its real path instead of painting its bounding rectangle", () => {
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({ geometry: freeformGeometry(), fill: "#ff0000" }),
      ),
      "shape",
    );
    // Relative commands, the `lineto` implied after a `moveto`, and
    // shortest-form numbers: the same outline as `M0 0 L96 0 C86.4 38.4 57.6
    // 76.8 28.8 96 Z`, spelled the way the path minifier writes it.
    expect(style).toContain(
      "clip-path: path('m0 0 96 0c-9.6 38.4-38.4 76.8-67.2 96z')",
    );
    // The clip is what stops the shape occluding its neighbours, so the fill
    // paints again rather than being suppressed.
    expect(style).toContain("background: #ff0000");
  });

  it("mirrors a flipH freeform across its own box", () => {
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          geometry: freeformGeometry(),
          fill: "#ff0000",
          flipH: true,
        }),
      ),
      "shape",
    );
    expect(style).toContain(
      "clip-path: path('m96 0-96 0c9.6 38.4 38.4 76.8 67.2 96z')",
    );
  });

  it("converts an arcTo against the current point, which is where OOXML starts the sweep", () => {
    // Quarter circle: start at (100,50), radii 50/50, sweeping 90deg from 0deg
    // puts the center at (50,50) and the end point at (50,100).
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          fill: "#ff0000",
          geometry: {
            kind: "custom",
            paths: [
              {
                w: 100,
                h: 100,
                commands: [
                  { kind: "moveTo", points: [{ x: 100, y: 50 }] },
                  {
                    kind: "arcTo",
                    wR: 50,
                    hR: 50,
                    stAng: 0,
                    swAng: 90 * 60000,
                  },
                  { kind: "close" },
                ],
              },
            ],
          },
        }),
      ),
      "shape",
    );
    expect(style).toContain("clip-path: path('m96 48a48 48 0 0 1-48 48z')");
  });

  it("strokes a freeform outline as its real path, not as a border around its box", () => {
    // A line-art pictogram: no fill, a stroked outline only. A `border` here
    // is exactly the generic square every icon used to collapse into.
    const html = convertToSlideHtml(
      shapeSlide({
        geometry: freeformGeometry(),
        lineColor: "#262626",
        lineWidth: 19050,
      }),
    );
    expect(styleAttr(html, "shape")).not.toMatch(/(?<!-)border(-\w+)?: /);
    expect(html).toContain(
      '<path d="m0 0 96 0c-9.6 38.4-38.4 76.8-67.2 96z" fill="none" stroke="#262626" stroke-width="1.5"',
    );
  });

  it("writes a long outline in relative steps without letting rounding drift off the true point", () => {
    // The reason this deck's HTML is worth minifying at all: one decorative
    // layout illustration in a real template carries thousands of segments,
    // and the layout layer repeats it on every slide that uses the layout. A
    // relative encoding is only safe if each step is measured from the point
    // that was *emitted*, not the exact one — chaining exact-to-exact deltas
    // walks the far end of a path like this several px off its box.
    const steps = 2000;
    const style = styleAttr(
      convertToSlideHtml(
        shapeSlide({
          fill: "#ff0000",
          geometry: {
            kind: "custom",
            paths: [
              {
                w: 10000,
                h: 10000,
                commands: [
                  { kind: "moveTo", points: [{ x: 0, y: 0 }] },
                  ...Array.from({ length: steps }, (_, index) => ({
                    kind: "lnTo" as const,
                    // 4.9997 path units per step: a delta that never lands on
                    // the 0.1px grid the writer rounds to.
                    points: [{ x: (index + 1) * 4.9997, y: index % 2 }],
                  })),
                ],
              },
            ],
          },
        }),
      ),
      "shape",
    );
    const data = style.match(/clip-path: path\('([^']*)'\)/)?.[1];
    if (!data) throw new Error(`no clip path in ${style}`);

    const numbers = data.match(/-?(?:\d+\.?\d*|\.\d+)/g)?.map(Number) ?? [];
    expect(numbers).toHaveLength((steps + 1) * 2);
    let x = 0;
    for (let index = 0; index < numbers.length; index += 2) {
      x += numbers[index]!;
    }
    // 96px box, 10000 path units: the last point's true x is 96 * (2000 *
    // 4.9997) / 10000, and it has to still be there after 2000 relative steps.
    expect(x).toBeCloseTo((96 * steps * 4.9997) / 10000, 1);
    // Same outline in absolute coordinates is ~1.9x this size.
    expect(data.length).toBeLessThan(14 * steps);
  });

  it("falls back to the shape's existing rendering when the geometry converts to nothing", () => {
    for (const geometry of [
      { kind: "custom" as const, paths: [] },
      { kind: "custom" as const, paths: [{ w: 200, h: 100, commands: [] }] },
      { kind: "custom" as const, paths: [{ w: 0, h: 0, commands: [] }] },
    ]) {
      const style = styleAttr(
        convertToSlideHtml(
          shapeSlide({ geometry, fill: "#ff0000", lineColor: "#000000" }),
        ),
        "shape",
      );
      expect(style).not.toContain("clip-path: path(");
      expect(style).toContain("background: #ff0000");
      expect(style).toContain("border: 1px solid #000000");
    }
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
    // The parser resolves a declared `spcPct val="100000"` to 1.2 — a
    // percentage of the font's own line height, not of its em size. An
    // inherited default has to land on the same number, and a bare `1` here
    // is the ~17% leading compression five unrelated decks were reported for.
    const declared = convertToSlideHtml(
      paragraphSlide([
        { runs: [{ content: "Hi", fontSize: 14 }], lineSpacing: 1.2 },
      ]),
    );
    const inherited = convertToSlideHtml(
      paragraphSlide([{ runs: [{ content: "Hi", fontSize: 14 }] }]),
    );
    const lineHeight = (html: string) =>
      html.match(/line-height:([\d.]+)/)?.[1];
    expect(lineHeight(inherited)).toBe(lineHeight(declared));
    expect(lineHeight(inherited)).toBe("1.2");
  });

  it("states a base direction on a right-to-left paragraph so mixed Arabic/Latin/numeral text keeps PowerPoint's order", () => {
    const html = convertToSlideHtml(
      paragraphSlide([
        {
          runs: [{ content: "مرحبا Builder 2026", fontSize: 14 }],
          rtl: true,
        },
        { runs: [{ content: "Latin only", fontSize: 14 }] },
      ]),
    );
    const rtlParagraph = html.match(/<p data-pptx-paragraph="0"([^>]*)>/)?.[1];
    const ltrParagraph = html.match(/<p data-pptx-paragraph="1"([^>]*)>/)?.[1];
    // `dir` is the semantic form; the CSS carries it past sanitizeSlideHtml,
    // whose ALLOWED_ATTRS drops `dir`.
    expect(rtlParagraph).toContain('dir="rtl"');
    expect(rtlParagraph).toContain("direction:rtl;");
    expect(rtlParagraph).toContain("text-align:right;");
    expect(ltrParagraph).not.toContain("dir=");
    expect(ltrParagraph).not.toContain("direction:");
    expect(ltrParagraph).toContain("text-align:left;");
  });

  it("sizes a blank spacer paragraph from its own text box, not the format-wide default", () => {
    const html = convertToSlideHtml(
      paragraphSlide([
        { runs: [{ content: "Body copy", fontSize: 14 }] },
        { runs: [] },
      ]),
    );
    // 14pt -> 14px in this slide's 960px reference box, x1.2 single spacing.
    // An 18pt fallback would reserve 21.6px more for an empty line inside a
    // 14pt box, and every blank paragraph would push the copy below it down.
    const blank = html.match(/data-pptx-paragraph="1" style="([^"]*)"/)?.[1];
    if (!blank) throw new Error("missing blank paragraph");
    expect(blank).toContain("font-size:14px");
    expect(blank).toContain("min-height:16.8px");
  });
});
