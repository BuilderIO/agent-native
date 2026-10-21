import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

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
