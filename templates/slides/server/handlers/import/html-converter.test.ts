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
});
