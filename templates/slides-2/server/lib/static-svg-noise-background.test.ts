import { describe, expect, it } from "vitest";

import {
  isSafeStaticSvgNoiseBackgroundCssValue,
  normalizeSvgNoiseBackgroundProps,
} from "./static-svg-noise-background.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MATRIX = Array.from({ length: 20 }, (_, index) =>
  index % 6 === 0 ? "1" : "0",
).join(" ");

function noiseSvg(
  overrides: {
    root?: string;
    filter?: string;
    turbulence?: string;
    colorMatrix?: string;
    rect?: string;
  } = {},
) {
  return `<svg ${overrides.root ?? `xmlns="${SVG_NAMESPACE}" width="220" height="220"`}><filter ${overrides.filter ?? 'id="noise" x="0" y="0" width="100%" height="100%"'}><feTurbulence ${overrides.turbulence ?? 'type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="4" stitchTiles="stitch" result="noise"'} /><feColorMatrix ${overrides.colorMatrix ?? `in="noise" type="matrix" values="${MATRIX}"`} /></filter><rect ${overrides.rect ?? 'width="220" height="220" filter="url(#noise)" opacity="0.2" fill="#fff"'} /></svg>`;
}

function cssUrl(
  xml: string,
  options: { quote?: "'" | '"'; charset?: boolean } = {},
) {
  const quote = options.quote ?? '"';
  const charset = options.charset ? ";charset=utf-8" : "";
  return `url(${quote}data:image/svg+xml${charset},${encodeURIComponent(xml)}${quote})`;
}

describe("isSafeStaticSvgNoiseBackgroundCssValue", () => {
  it("accepts the bounded static noise texture with percent-encoded XML", () => {
    expect(isSafeStaticSvgNoiseBackgroundCssValue(cssUrl(noiseSvg()))).toBe(
      true,
    );
  });

  it("accepts both source texture sizes and bounded source frequencies", () => {
    for (const [dimension, frequency] of [
      ["220", "0.012"],
      ["420", "0.9"],
    ]) {
      const value = cssUrl(
        noiseSvg({
          root: `xmlns="${SVG_NAMESPACE}" width="${dimension}" height="${dimension}"`,
          turbulence: `type="fractalNoise" baseFrequency="${frequency}" numOctaves="3" stitchTiles="stitch" result="noise"`,
          rect: `width="${dimension}" height="${dimension}" filter="url(#noise)"`,
        }),
      );
      expect(isSafeStaticSvgNoiseBackgroundCssValue(value)).toBe(true);
    }
  });

  it("accepts single-quoted URLs and the UTF-8 charset parameter", () => {
    expect(
      isSafeStaticSvgNoiseBackgroundCssValue(
        cssUrl(noiseSvg(), { quote: "'", charset: true }),
      ),
    ).toBe(true);
  });

  it("accepts apostrophes in XML inside a double-quoted CSS URL", () => {
    const xml = noiseSvg().replaceAll('"', "'");
    expect(
      isSafeStaticSvgNoiseBackgroundCssValue(
        `url("data:image/svg+xml,${encodeURIComponent(xml)}")`,
      ),
    ).toBe(true);
  });

  it("accepts a strictly padded base64 SVG data URL", () => {
    const encoded = Buffer.from(noiseSvg(), "utf8").toString("base64");
    expect(
      isSafeStaticSvgNoiseBackgroundCssValue(
        `url("data:image/svg+xml;base64,${encoded}")`,
      ),
    ).toBe(true);
  });

  it.each([
    "url(data:image/svg+xml,%3Csvg%2F%3E)",
    'url("https://example.test/noise.svg")',
    'url("data:image/png;base64,AAAA")',
    `linear-gradient(black, white), ${cssUrl(noiseSvg())}`,
  ])("rejects non-quoted, remote, non-SVG, or compound CSS URLs", (value) => {
    expect(isSafeStaticSvgNoiseBackgroundCssValue(value)).toBe(false);
  });

  it.each([
    [
      "a different namespace",
      noiseSvg({ root: 'xmlns="urn:wrong" width="128" height="128"' }),
    ],
    [
      "an unknown SVG attribute",
      noiseSvg({
        filter:
          'id="noise" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse"',
      }),
    ],
    [
      "a script element",
      noiseSvg().replace("<filter", "<script>alert(1)</script><filter"),
    ],
    [
      "an animation element",
      noiseSvg().replace("<rect", '<animate attributeName="opacity" /><rect'),
    ],
    ["text content", noiseSvg().replace("<rect", "noise<rect")],
    [
      "an entity",
      noiseSvg().replace("opacity=", 'data-value="&amp;" opacity='),
    ],
    ["a declaration", `<!DOCTYPE svg>${noiseSvg()}`],
    ["a comment", noiseSvg().replace("<filter", "<!--x--><filter")],
    ["duplicate attributes", noiseSvg({ filter: 'id="noise" id="other"' })],
  ])("rejects SVG containing %s", (_label, xml) => {
    expect(isSafeStaticSvgNoiseBackgroundCssValue(cssUrl(xml))).toBe(false);
  });

  it.each([
    [
      "a remote filter reference",
      'width="220" height="220" filter="url(https://example.test/noise#noise)"',
    ],
    [
      "a mismatched local filter reference",
      'width="220" height="220" filter="url(#other)"',
    ],
    [
      "a remote image reference",
      'width="220" height="220" filter="url(#noise)" href="https://example.test/"',
    ],
  ])("rejects %s", (_label, rect) => {
    expect(
      isSafeStaticSvgNoiseBackgroundCssValue(cssUrl(noiseSvg({ rect }))),
    ).toBe(false);
  });

  it.each([
    [
      "an invalid frequency",
      'type="fractalNoise" baseFrequency="1.1" numOctaves="3" stitchTiles="stitch"',
    ],
    [
      "an unbounded octave count",
      'type="fractalNoise" baseFrequency="0.8" numOctaves="5" stitchTiles="stitch"',
    ],
    [
      "an invalid stitch mode",
      'type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="external"',
    ],
    [
      "a missing stitch mode",
      'type="fractalNoise" baseFrequency="0.8" numOctaves="3"',
    ],
  ])("rejects turbulence with %s", (_label, turbulence) => {
    expect(
      isSafeStaticSvgNoiseBackgroundCssValue(cssUrl(noiseSvg({ turbulence }))),
    ).toBe(false);
  });

  it.each([
    ["19 values", MATRIX.split(" ").slice(1).join(" ")],
    ["21 values", `${MATRIX} 0`],
    ["a non-finite value", MATRIX.replace("1", "NaN")],
    ["an out-of-range value", MATRIX.replace("1", "101")],
  ])("rejects a color matrix with %s", (_label, values) => {
    expect(
      isSafeStaticSvgNoiseBackgroundCssValue(
        cssUrl(
          noiseSvg({
            colorMatrix: `in="noise" type="matrix" values="${values}"`,
          }),
        ),
      ),
    ).toBe(false);
  });

  it.each([
    [
      "an oversized dimension",
      'xmlns="http://www.w3.org/2000/svg" width="513" height="513"',
    ],
    [
      "a zero dimension",
      'xmlns="http://www.w3.org/2000/svg" width="0" height="220"',
    ],
    [
      "a non-covering rectangle",
      'width="100%" height="100%" filter="url(#noise)"',
    ],
  ])("rejects %s", (_label, value) => {
    const xml = value.includes("xmlns=")
      ? noiseSvg({ root: value })
      : noiseSvg({ rect: value });
    expect(isSafeStaticSvgNoiseBackgroundCssValue(cssUrl(xml))).toBe(false);
  });

  it.each([
    'url("data:image/svg+xml,%")',
    'url("data:image/svg+xml,%C3%28")',
    'url("data:image/svg+xml,%3Csvg%3E")',
    'url("data:image/svg+xml;base64,PHN2Zy8+\n")',
  ])("rejects malformed or incomplete encoded SVG data URLs", (value) => {
    expect(isSafeStaticSvgNoiseBackgroundCssValue(value)).toBe(false);
  });

  it("rejects XML attributes without whitespace separators", () => {
    const xml = noiseSvg().replace(
      `xmlns="${SVG_NAMESPACE}" width="220"`,
      `xmlns="${SVG_NAMESPACE}"width="220"`,
    );
    expect(isSafeStaticSvgNoiseBackgroundCssValue(cssUrl(xml))).toBe(false);
  });

  it("accepts the maximum bounded texture dimensions", () => {
    const value = cssUrl(
      noiseSvg({
        root: `xmlns="${SVG_NAMESPACE}" width="512" height="512"`,
        rect: 'width="512" height="512" filter="url(#noise)"',
      }),
    );
    expect(isSafeStaticSvgNoiseBackgroundCssValue(value)).toBe(true);
  });

  it("rejects URL and decoded XML payloads above their size bounds", () => {
    expect(
      isSafeStaticSvgNoiseBackgroundCssValue(
        `url("data:image/svg+xml,${"%41".repeat(9_000)}")`,
      ),
    ).toBe(false);
    expect(
      isSafeStaticSvgNoiseBackgroundCssValue(
        cssUrl(
          noiseSvg({
            turbulence: `type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${"4".repeat(8_200)}"`,
          }),
        ),
      ),
    ).toBe(false);
  });
});

describe("normalizeSvgNoiseBackgroundProps", () => {
  it("returns safe defaults and bounded static overrides", () => {
    expect(normalizeSvgNoiseBackgroundProps({})).toEqual({
      baseFrequency: 0.012,
      numOctaves: 3,
      seed: 4,
      opacity: 0.2,
      fill: "white",
    });
    expect(
      normalizeSvgNoiseBackgroundProps({
        baseFrequency: 0.03,
        numOctaves: 4,
        seed: 12,
        opacity: 0.5,
        fill: "#aabbcc",
        "data-slide-loc": "2:4",
      }),
    ).toEqual({
      baseFrequency: 0.03,
      numOctaves: 4,
      seed: 12,
      opacity: 0.5,
      fill: "#aabbcc",
      dataSlideLoc: "2:4",
    });
  });

  it("rejects unbounded or unknown props", () => {
    for (const props of [
      { baseFrequency: 1.01 },
      { baseFrequency: 0 },
      { numOctaves: 5 },
      { numOctaves: 1.5 },
      { seed: 10_001 },
      { opacity: -0.1 },
      { opacity: 1.1 },
      { fill: "url(https://example.test/noise.svg)" },
      { style: { filter: "url(#unsafe)" } },
      { "data-slide-loc": "invalid" },
    ]) {
      expect(normalizeSvgNoiseBackgroundProps(props)).toBeNull();
    }
  });
});
