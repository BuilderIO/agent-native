import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { sanitizeSlideHtml } from "../../app/lib/sanitize-slide-html";
import { MAX_SLIDE_SOURCE_BYTES } from "./slide-source-limits.js";
import {
  collectSlideAssetIds,
  renderSlideSource,
  splitSlideSourcePages,
} from "./slide-source.js";

function slideSourceWithByteLength(byteLength: number): string {
  const suffix =
    "*/\nexport default function Slide() { return <main>OK</main>; }";
  const paddingLength = byteLength - Buffer.byteLength(`/*${suffix}`);
  return `/*${"x".repeat(paddingLength)}${suffix}`;
}

function renderWithStyleValue(value: string): string {
  const source = `export default function Slide() { return <div style={{ backgroundImage: ${JSON.stringify(value)} }} />; }`;
  return renderSlideSource(source, new Map());
}

function renderWithStyleProperty(property: string, value: string): string {
  const source = `export default function Slide() { return <div style={{ ${property}: ${JSON.stringify(value)} }} />; }`;
  return renderSlideSource(source, new Map());
}

describe("slide source renderer media policy", () => {
  it("accepts a source module at the 256 KiB UTF-8 boundary", () => {
    const source = slideSourceWithByteLength(MAX_SLIDE_SOURCE_BYTES);

    expect(Buffer.byteLength(source, "utf8")).toBe(MAX_SLIDE_SOURCE_BYTES);
    expect(renderSlideSource(source, new Map())).toMatch(
      /<main[^>]*>OK<\/main>/,
    );
  });

  it("rejects UTF-8 byte overflow even when source character count is below the cap", () => {
    const suffix = "*/\nexport default function Slide() { return <main />; }";
    const paddingBytes =
      MAX_SLIDE_SOURCE_BYTES + 1 - Buffer.byteLength(`/*${suffix}`);
    const source = `/*${"é".repeat(Math.ceil(paddingBytes / 2))}${suffix}`;

    expect(source.length).toBeLessThan(MAX_SLIDE_SOURCE_BYTES);
    expect(Buffer.byteLength(source, "utf8")).toBeGreaterThan(
      MAX_SLIDE_SOURCE_BYTES,
    );
    expect(() => renderSlideSource(source, new Map())).toThrow(
      "Slide source must be at most 256 KiB.",
    );
  });

  it("collects uploaded video sources and poster references", () => {
    const source = `export default function Slide() { return <video src={"asset://video-1"} poster={"asset://poster-1"} controls playsInline preload="metadata" />; }`;

    expect(collectSlideAssetIds(source)).toEqual(["video-1", "poster-1"]);
  });

  it("renders video only from resolved asset handles", () => {
    const source = `export default function Slide() { return <video src={"asset://video-1"} poster={"asset://poster-1"} controls playsInline preload="metadata" muted />; }`;
    const markup = renderSlideSource(
      source,
      new Map([
        ["video-1", "https://assets.example.invalid/video.mp4"],
        ["poster-1", "https://assets.example.invalid/poster.jpg"],
      ]),
    );

    expect(markup).toContain('src="https://assets.example.invalid/video.mp4"');
    expect(markup).toContain(
      'poster="https://assets.example.invalid/poster.jpg"',
    );
    expect(markup).toContain('playsInline=""');
  });

  it("renders bounded NoiseBackground as inline SVG without a data URL", () => {
    const source = `import { NoiseBackground } from "@agent-native/slides-core"; export default function Slide() { return <main><NoiseBackground baseFrequency={0.03} numOctaves={2} seed={8} opacity={0.4} fill="#abc" /></main>; }`;
    const markup = renderSlideSource(source, new Map());

    expect(markup).toContain("<feTurbulence");
    expect(markup).toContain("<feColorMatrix");
    expect(markup).toContain('filter="url(#slides2-noise-1)"');
    expect(markup).toContain('baseFrequency="0.03"');
    expect(markup).not.toContain("data:image");
    const sanitized = sanitizeSlideHtml(markup);
    expect(sanitized).toContain("<feTurbulence");
    expect(sanitized).toContain('filter="url(#slides2-noise-1)"');
  });

  it("keeps supported core imports alongside the NoiseBackground primitive", () => {
    const source = `import { NoiseBackground, Step as Reveal, Steps as Build, useSlidePageNumber } from "@agent-native/slides-core"; export default function Slide() { const { current, total } = useSlidePageNumber(); return <main><Build><Reveal duration={240}><h1>{current}/{total}</h1></Reveal></Build><NoiseBackground /></main>; }`;
    const markup = renderSlideSource(source, new Map());

    expect(markup).toContain('data-slides2-step="revealed"');
    expect(markup).toContain('data-slides2-step-duration="240"');
    expect(markup).toContain("1/1");
    expect(markup).toContain("<feTurbulence");
    expect(markup).not.toContain("<Reveal");
    expect(markup).not.toContain("<Build");
  });

  it("statically renders useId and inactive-page context for stored sources", () => {
    const source = `import { useId } from "react"; import { Step, Steps, useIsActivePage, useSlidePageNumber } from "@agent-native/slides-core"; export default function Slide() { const id = useId(); const active = useIsActivePage(); const { current, total } = useSlidePageNumber(); return <main id={id}><a href={"#" + id}>{current}/{total}</a><Steps><Step>{active ? "active" : "inactive"}</Step></Steps></main>; }`;
    const markup = renderSlideSource(source, new Map());

    expect(markup).toMatch(/<main[^>]*id="slides2-use-id-1"/);
    expect(markup).toContain('href="#slides2-use-id-1"');
    expect(markup).toContain("1/1");
    expect(markup).toContain(">inactive</div>");
    expect(markup).toContain('data-slides2-step="revealed"');

    const withArguments = `import { useId } from "react"; export default function Slide() { const id = useId(1); return <main id={id} />; }`;
    expect(() => renderSlideSource(withArguments, new Map())).toThrow(
      "useId does not accept arguments.",
    );
  });

  it("bounds generated IDs and rejects unsupported React imports", () => {
    const overLimit = Array.from(
      { length: 129 },
      () => "<span id={useId()} />",
    ).join("");
    const tooManyIds = `import { useId } from "react"; export default function Slide() { return <main>${overLimit}</main>; }`;
    expect(() => renderSlideSource(tooManyIds, new Map())).toThrow(
      "Slide uses too many generated IDs.",
    );

    const unsupported = `import { useState } from "react"; export default function Slide() { return <main />; }`;
    expect(() => renderSlideSource(unsupported, new Map())).toThrow(
      expect.objectContaining({
        message:
          "Static slide rendering supports only React useId and built-in components from @agent-native/slides-core.",
        statusCode: 422,
        errorCode: "invalid_slide_source",
      }),
    );
  });

  it("evaluates static function and prop defaults in declaration order", () => {
    const source = `const label = (value, fallback = value) => fallback; const placement = (left, extra = {}) => ({ position: "absolute", left, ...extra }); const Badge = ({ className = "badge" }) => <span class={className} style={placement(12, { top: 4 })}>{label("ready")}</span>; export default function Slide() { return <main><Badge /></main>; }`;
    const markup = renderSlideSource(source, new Map());

    expect(markup).toMatch(/<span[^>]*class="badge"/);
    expect(markup).toContain("position:absolute;left:12px;top:4px");
    expect(markup).toContain(">ready</span>");

    const invalidSpread = `const value = ["unsafe"]; const style = { ...value }; export default function Slide() { return <main style={style} />; }`;
    expect(() => renderSlideSource(invalidSpread, new Map())).toThrow(
      "Object spreads must use bounded plain objects.",
    );
  });

  it("passes bounded static custom props to local components", () => {
    const source = `const Sheet = ({ scale = "NTS" }) => <span>{scale}</span>; export default function Slide() { return <main><Sheet scale="1:500" /></main>; }`;
    const markup = renderSlideSource(source, new Map());

    expect(markup).toContain(">1:500</span>");
    expect(markup).not.toContain('scale="1:500"');

    const eventProp = `const Badge = () => <span />; export default function Slide() { return <main><Badge onClick="alert" /></main>; }`;
    expect(() => renderSlideSource(eventProp, new Map())).toThrow(
      'Attribute "onClick" is not allowed.',
    );
  });

  it("evaluates bounded math, comparisons, and string helpers", () => {
    const source = `const clean = (raw) => raw.replace(/[^a-zA-Z0-9]/g, ""); export default function Slide() { return <main>{clean("A-b")}:{Math.hypot(3, 4).toFixed(1)}:{String(Math.PI).slice(0, 4)}:{String(7).padStart(2, "0")}:{[1, 2].includes(2) && 1 < 2 ? "yes" : "no"}</main>; }`;
    expect(renderSlideSource(source, new Map())).toContain(
      ">Ab:5.0:3.14:07:yes</main>",
    );

    const unsafeRegex = `const clean = (raw) => raw.replace(/(.+)+$/g, ""); export default function Slide() { return <main>{clean("bounded")}</main>; }`;
    expect(() => renderSlideSource(unsafeRegex, new Map())).toThrow(
      "Only bounded identifier cleanup is supported.",
    );
  });

  it("supports bounded static array spreads and SVG pattern attributes", () => {
    const source = `const base = [1, 2]; const label = ([x, y]) => x + ":" + y; const Values = ({ values }) => <span>{values.join(",")}</span>; export default function Slide() { return <main>{[0, ...base, 3].join(",")}:{label([4, 5])}<Values values={[6, 7]} /><svg><defs><pattern id="p" width={12} height={12} patternUnits="userSpaceOnUse" patternTransform="rotate(45)" /></defs></svg></main>; }`;
    const markup = renderSlideSource(source, new Map());

    expect(markup).toContain(">0,1,2,3");
    expect(markup).toContain(":4:5");
    expect(markup).toContain(">6,7</span>");
    expect(markup).toContain('patternUnits="userSpaceOnUse"');
    expect(markup).toContain('patternTransform="rotate(45)"');

    const invalidSpread = `const value = { length: 2 }; export default function Slide() { return <main>{[...value]}</main>; }`;
    expect(() => renderSlideSource(invalidSpread, new Map())).toThrow(
      "Array spreads must use bounded static arrays.",
    );
  });

  it("calls static helper functions stored on bounded objects", () => {
    const source = `const geo = (offset, scale) => ({ X: (value) => offset + value * scale }); const format = (g, value) => g.X(value).toFixed(1); export default function Slide() { return <main>{format(geo(2, 3), 4)}</main>; }`;
    expect(renderSlideSource(source, new Map())).toContain(">14.0</main>");
  });

  it("rejects unsupported core imports", () => {
    const source = `import { UnboundedSvg } from "@agent-native/slides-core"; export default function Slide() { return <UnboundedSvg />; }`;

    expect(() => renderSlideSource(source, new Map())).toThrow(
      /only built-in components from @agent-native\/slides-core/,
    );
  });

  it("bounds NoiseBackground props and render count", () => {
    const invalid = `import { NoiseBackground } from "@agent-native/slides-core"; export default function Slide() { return <NoiseBackground numOctaves={5} />; }`;
    expect(() => renderSlideSource(invalid, new Map())).toThrow(
      /NoiseBackground props must use bounded static values/,
    );

    const repeated = Array.from(
      { length: 9 },
      () => "<NoiseBackground />",
    ).join("");
    const overLimit = `import { NoiseBackground } from "@agent-native/slides-core"; export default function Slide() { return <main>${repeated}</main>; }`;
    expect(() => renderSlideSource(overLimit, new Map())).toThrow(
      /too many filtered backgrounds/,
    );
  });

  it("rejects a remote video poster that bypasses uploaded asset storage", () => {
    const source = `export default function Slide() { return <video src={"asset://video-1"} poster="https://media.example.invalid/poster.jpg" />; }`;

    expect(() =>
      renderSlideSource(
        source,
        new Map([["video-1", "https://assets.example.invalid/video.mp4"]]),
      ),
    ).toThrow(/Media sources must use asset:\/\//);
  });

  it("rejects CSS escaped url() functions", () => {
    expect(() =>
      renderWithStyleValue("\\75rl(https://media.example.invalid/pixel.png)"),
    ).toThrow(/CSS value/);
  });

  it("rejects comment-obfuscated url() functions", () => {
    expect(() =>
      renderWithStyleValue("url/**/(https://media.example.invalid/pixel.png)"),
    ).toThrow(/CSS value|CSS function/);
  });

  it("rejects image-set network sources and CSS-variable URL construction", () => {
    expect(() =>
      renderWithStyleValue(
        'image-set("https://media.example.invalid/pixel.png" 1x)',
      ),
    ).toThrow(/CSS value|CSS function/);

    const source = `export default function Slide() { return <div style={{ "--deck-source": "url", backgroundImage: "var(--deck-source)(https://media.example.invalid/pixel.png)" }} />; }`;
    expect(() => renderSlideSource(source, new Map())).toThrow(/CSS value/);

    const backgroundSource = `export default function Slide() { return <div style={{ "--deck-source": "url", background: "var(--deck-source)(https://media.example.invalid/pixel.png)" }} />; }`;
    expect(() => renderSlideSource(backgroundSource, new Map())).toThrow(
      /CSS value/,
    );
  });

  it("allows gradients and local SVG paint references", () => {
    const source = `export default function Slide() { return <><div style={{ background: "var(--deck-bg)" }} /><svg><defs><linearGradient id="paint"><stop offset="0%" stopColor="#fff" /></linearGradient></defs><path fill="url(#paint)" d="M0 0" style={{ backgroundImage: "linear-gradient(90deg, #fff, #000)" }} /></svg></>; }`;
    expect(renderSlideSource(source, new Map())).toContain(
      'fill="url(#paint)"',
    );
  });

  it("allows only bounded static radial-gradient masks", () => {
    expect(
      renderWithStyleProperty(
        "mask",
        "radial-gradient(circle, transparent 60%, #f4f4f6 61%)",
      ),
    ).toContain("mask:radial-gradient(circle, transparent 60%, #f4f4f6 61%)");

    for (const value of [
      "url(https://media.example.invalid/pixel.png)",
      'radial-gradient(circle, transparent 60%, image-set("https://media.example.invalid/pixel.png" 1x) 61%)',
      "radial-gradient(circle, transparent 60%, var(--external-color) 61%)",
      "radial-gradient(circle, transparent 101%, #f4f4f6 61%)",
      "radial-gradient(circle, transparent 60%, #f4f4f6 61%), url(https://media.example.invalid/pixel.png)",
    ]) {
      expect(() => renderWithStyleProperty("mask", value)).toThrow(
        /CSS property "mask" can initiate network requests/,
      );
    }
  });

  it("allows bounded grid track functions and blur only in matching properties", () => {
    expect(
      renderWithStyleProperty(
        "gridTemplateColumns",
        "150px repeat(6, 1fr) 1.5fr",
      ),
    ).toContain("repeat(6, 1fr)");
    expect(
      renderWithStyleProperty(
        "gridTemplateColumns",
        "minmax(0, 1.12fr) minmax(260px, .88fr)",
      ),
    ).toContain("minmax(260px, .88fr)");
    expect(renderWithStyleProperty("filter", "blur(46px)")).toContain(
      "filter:blur(46px)",
    );

    expect(() => renderWithStyleProperty("width", "repeat(3, 1fr)")).toThrow(
      /CSS function/,
    );
    expect(() =>
      renderWithStyleProperty("gridTemplateColumns", "repeat(13, 1fr)"),
    ).toThrow(/CSS function/);
    expect(() =>
      renderWithStyleProperty(
        "gridTemplateColumns",
        "repeat(12, 1fr) repeat(12, 1fr) 1fr",
      ),
    ).toThrow(/CSS function/);
    expect(() =>
      renderWithStyleProperty(
        "gridTemplateColumns",
        "repeat(3, url(https://media.example.invalid/pixel.png))",
      ),
    ).toThrow(/CSS function/);
    expect(() => renderWithStyleProperty("filter", "blur(65px)")).toThrow(
      /CSS function/,
    );
    expect(() => renderWithStyleProperty("filter", "none")).toThrow(
      /bounded blur/,
    );
    expect(() =>
      renderWithStyleProperty(
        "filter",
        "blur(46px) url(https://media.example.invalid/pixel.png)",
      ),
    ).toThrow(/CSS function/);
    expect(() => renderWithStyleProperty("background", "blur(46px)")).toThrow(
      /CSS function/,
    );
  });

  it("bounds aggregate expansion from nested static array maps before allocating unbounded output", () => {
    const entries = Array.from({ length: 7_900 }, () => '"x"').join(",");
    const source = `const xs = [${entries}]; export default function Slide() { return <>{xs.map(() => xs.map(() => "x"))}</>; }`;
    expect(() => renderSlideSource(source, new Map())).toThrow(
      /static evaluation limit/,
    );
  });

  it("splits a static Page array into one source-backed page per local component", () => {
    const source = `
function Cover() { return <main><h1>Cover</h1></main>; }
function Body() { return <main><h1>Body</h1></main>; }
function Closing() { return <main><h1>Closing</h1></main>; }
export const notes: (string | undefined)[] = ["Cover notes", undefined];
export default [Cover, Body, Closing] satisfies Page[];
`;
    const pages = splitSlideSourcePages(source);

    expect(pages).toHaveLength(3);
    expect(pages[0]?.sourceTsx).toContain("export default Cover;");
    expect(pages[1]?.sourceTsx).toContain("export default Body;");
    expect(pages[2]?.sourceTsx).toContain("export default Closing;");
    expect(pages.map((page) => page.notes)).toEqual(["Cover notes", "", ""]);
    expect(renderSlideSource(pages[0]!.sourceTsx, new Map())).toContain(
      "Cover",
    );
    expect(renderSlideSource(pages[1]!.sourceTsx, new Map())).toContain("Body");
    expect(renderSlideSource(pages[2]!.sourceTsx, new Map())).toContain(
      "Closing",
    );
  });

  it("splits a static Page array exported through a local const", () => {
    const source = `
function Cover() { return <main><h1>Cover</h1></main>; }
function Body() { return <main><h1>Body</h1></main>; }
const pages: Page[] = [Cover, Body];
export const notes = ["Cover notes", "Body notes"];
export default pages;
`;
    const pages = splitSlideSourcePages(source);

    expect(pages).toHaveLength(2);
    expect(pages[0]?.sourceTsx).toContain("export default Cover;");
    expect(pages[1]?.sourceTsx).toContain("export default Body;");
    expect(pages.map((page) => page.notes)).toEqual([
      "Cover notes",
      "Body notes",
    ]);
  });

  it("keeps note array positions and rejects extra or dynamic speaker notes", () => {
    expect(() =>
      splitSlideSourcePages(
        'export const notes = ["first", "second"]; export default [A];',
      ),
    ).toThrow(/more entries than the slide page array/);

    expect(() =>
      splitSlideSourcePages(
        "export const notes = [getNotes()]; export default [A];",
      ),
    ).toThrow(/static strings or empty values/);
  });

  it("rejects dynamic or over-limit Page arrays without evaluating them", () => {
    expect(() =>
      splitSlideSourcePages("export default pages.map(renderPage);"),
    ).toThrow(/static component or a static local Page array/i);

    const pages = Array.from({ length: 41 }, (_, index) => `Page${index}`).join(
      ",",
    );
    const source = `function Page0() { return <div />; } export default [${pages}];`;
    expect(() => splitSlideSourcePages(source)).toThrow(
      /between 1 and 40 static pages/,
    );
  });
});
