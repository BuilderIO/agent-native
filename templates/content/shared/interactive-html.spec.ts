import { describe, expect, it } from "vitest";

import {
  interactiveHtmlBlocks,
  interactiveHtmlProblems,
  interactiveHtmlTitle,
  MAX_INTERACTIVE_HTML_IMAGES,
  MAX_INTERACTIVE_HTML_LENGTH,
  refusedInteractiveHtml,
} from "./interactive-html.js";
import { canonicalizeNfm, nfmToDoc } from "./nfm.js";

const ALLOWED = {
  imageSources: ["data:", "blob:", "https://media.example.com"],
  mediaSources: ["data:"],
};

const COUNTER = [
  "<title>Tap counter</title>",
  '<button id="tap">0</button>',
  "<script>",
  "\ttap.onclick = () => tap.textContent++;",
  "</script>",
].join("\n");

const page = (...sources: string[]) =>
  [
    "Before.",
    ...sources.map((source) => `\`\`\`html interactive\n${source}\n\`\`\``),
    "After.",
  ].join("\n");

const problems = (source: string) => interactiveHtmlProblems(source, ALLOWED);

describe("interactive HTML in a page's Markdown", () => {
  it("is a code block whose source and language round-trip exactly", () => {
    const body = page(COUNTER);

    expect(canonicalizeNfm(body)).toBe(body);
    expect(nfmToDoc(body).content[1]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "html interactive" },
      content: [{ text: COUNTER }],
    });
  });

  it("is found at any depth, in reading order, apart from other code", () => {
    const body = [
      "```html",
      "<title>Plain code</title>",
      "```",
      "<details>",
      "<summary>Toggle</summary>",
      "\t```html interactive",
      "\t<title>Inside</title>",
      "\t```",
      "</details>",
      "~~~~HTML  Interactive",
      "```js",
      "<title>Outside</title>",
      "~~~~",
    ].join("\n");

    expect(interactiveHtmlBlocks(body).map(({ title }) => title)).toEqual([
      "Inside",
      "Outside",
    ]);
  });
});

describe("a block's title", () => {
  it.each([
    ["<title>Tip &amp; tax\n  calculator</title>", "Tip & tax calculator"],
    ['<TITLE lang="en">Upper</TITLE >', "Upper"],
    ["<title>  </title>", null],
    ["<p>No title</p>", null],
  ])("%s", (source, title) => {
    expect(interactiveHtmlTitle(source)).toBe(title);
  });

  it("is cut to a length a caption can hold", () => {
    expect(
      interactiveHtmlTitle(`<title>${"a".repeat(500)}</title>`),
    ).toHaveLength(120);
  });
});

describe("what a block can't do is named before it is saved", () => {
  it("accepts scripts, styles and fonts from the library host and inline", () => {
    expect(
      problems(`<!doctype html>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/inter/index.css">
        <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script>
        <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
        <script type="module">import * as THREE from "three"; const at = "https://example.com/";</script>
        <img src="https://media.example.com/a.png"><img src="data:image/png;base64,AA==">
        <img src="/api/private-media/11111111-2222-4333-8444-555555555555"><a href="https://example.com">Out</a>
        <svg xmlns="http://www.w3.org/2000/svg"><use href="#x"/></svg>
        <style>
          @namespace svg url(http://www.w3.org/2000/svg);
          /* @import "https://fonts.example.com/a.css"; */
          @font-face { font-family: A; src: url("https://cdn.jsdelivr.net/a.woff2") }
          body { background: url("https://media.example.com/b.png") }
        </style>
        <textarea><img src="https://tracker.example.net/p.gif"></textarea>`),
    ).toEqual([]);
  });

  it.each([
    [
      "an import in a comment or a string",
      `<script type="module">
        // import x from "https://esm.sh/x"; don't
        /* import "https://esm.sh/y" */
        const usage = 'import z from "https://esm.sh/z"';
        import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
      </script>`,
    ],
    [
      "an import from the library host in any form",
      `<script type="module">
        import * as d3 from "//cdn.jsdelivr.net/npm/d3@7/+esm";
        const name = "three";
        const three = await import(\`https://cdn.jsdelivr.net/npm/\${name}\`);
        const later = await import(\`https://\${location.host}/x\`);
      </script>`,
    ],
    [
      "an address that isn't an import",
      `<script>const parts = Array.from("/a/b"); const at = "./c.js";</script>`,
    ],
    [
      "a page named by an import map's scope",
      `<script type="importmap">{"imports":{"a":"https://cdn.jsdelivr.net/npm/a"},
        "scopes":{"https://app.example.com/":{"b":"https://cdn.jsdelivr.net/npm/b"}}}</script>`,
    ],
    [
      "styles that name their own elements and data",
      `<style>@font-face { font-family: A; src: url(data:font/woff2;base64,AA==) }
        p { mask: url(#cut); background: url("data:image/svg+xml,%3Csvg fill='url(%23g)'/%3E") }</style>`,
    ],
  ])("accepts %s", (_name, source) => {
    expect(problems(source)).toEqual([]);
  });

  it.each([
    ['<script src="https://unpkg.com/react"></script>', "unpkg.com/react"],
    ["<script src=//esm.sh/react></script>", "//esm.sh/react"],
    [
      '<script type="module">import x from "https://esm.sh/x"</script>',
      "https://esm.sh/x",
    ],
    [
      '<script type="module">await import("https://esm.sh/y")</script>',
      "https://esm.sh/y",
    ],
    [
      '<script type="importmap">{"imports":{"a":"https://esm.sh/a"}}</script>',
      "https://esm.sh/a",
    ],
    [
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      "fonts.googleapis.com",
    ],
    [
      "<style>@import url('https://fonts.example.com/a.css');</style>",
      "fonts.example.com",
    ],
    ['<img src="https://tracker.example.net/p.gif">', "tracker.example.net"],
    ['<video src="https://media.example.com/a.mp4"></video>', "a.mp4"],
    ['<iframe src="https://example.com"></iframe>', "<iframe>"],
    [
      '<img srcset="data:image/png;base64,AA== 1x, https://tracker.example.net/2x.png 2x">',
      "2x.png",
    ],
    [
      '<img srcset="https://media.example.com/a.png 1x,https://tracker.example.net/3x.png 3x">',
      "3x.png",
    ],
    [
      '<script type="module">/* one */ import x from "https://esm.sh/late"</script>',
      "https://esm.sh/late",
    ],
    [
      '<script type="module">import x from "//esm.sh/relative"</script>',
      "//esm.sh/relative",
    ],
    ['<script type="module">export * from"./lib/a.js"</script>', "./lib/a.js"],
    ['<script type="module">import "../b.js"</script>', "../b.js"],
    ['<script>import("/c.js")</script>', "/c.js"],
    [
      "<script>const x = await import(`https://esm.sh/${name}`)</script>",
      "https://esm.sh/",
    ],
    [
      "<script>await import(`//esm.sh/template`); const html = `<p>`</script>",
      "//esm.sh/template",
    ],
    [
      '<script type="importmap">{"imports":{"a":"//esm.sh/a"}}</script>',
      "//esm.sh/a",
    ],
    ['<script type="importmap">{"imports":{"a":"./a.js"}}</script>', "./a.js"],
    ['<style>@import "theme.css";</style>', "theme.css"],
    ["<style>@font-face{src:url('fonts/a.woff2')}</style>", "fonts/a.woff2"],
    ["<style>body{background:url(images/a.png)}</style>", "images/a.png"],
    [
      '<svg><image href="https://tracker.example.net/i.svg"/></svg>',
      "tracker.example.net/i.svg",
    ],
    [
      '<video><track src="https://subs.example.net/a.vtt"></video>',
      "subs.example.net",
    ],
    [
      "<style>@font-face{src:url(https://fonts.example.com/f.woff2)}</style>",
      "fonts.example.com/f.woff2",
    ],
    [
      '<style>@import "//fonts.example.com/b.css";</style>',
      "//fonts.example.com/b.css",
    ],
    [
      '<p style="background:url(https://tracker.example.net/q.png)">',
      "tracker.example.net/q.png",
    ],
  ])("refuses %s", (source, named) => {
    const [problem, ...rest] = problems(source);

    expect(problem).toContain(named);
    expect(rest).toEqual([]);
  });

  it("reads markup only: a tag in a comment or a script's text is left alone", () => {
    expect(
      problems(
        `<!-- <script src="https://unpkg.com/x"></script> -->
         <script>const html = '<img src="https://tracker.example.net/p.gif">';</script>`,
      ),
    ).toEqual([]);
  });

  it("refuses more uploaded images than a block shows", () => {
    const images = (count: number) =>
      Array.from(
        { length: count },
        (_, index) =>
          `<img src="/api/private-media/11111111-2222-4333-8444-5555555555${10 + index}">`,
      ).join("");

    expect(problems(images(MAX_INTERACTIVE_HTML_IMAGES))).toEqual([]);
    expect(problems(images(MAX_INTERACTIVE_HTML_IMAGES + 1))).toEqual([
      expect.stringContaining("41 images"),
    ]);
  });

  it("refuses an empty block and one too long to keep", () => {
    expect(problems(" \n")).toHaveLength(1);
    expect(problems("a".repeat(MAX_INTERACTIVE_HTML_LENGTH + 1))).toHaveLength(
      1,
    );
  });

  it("checks only the blocks an edit adds or changes", () => {
    const broken = '<script src="https://unpkg.com/react"></script>';

    expect(refusedInteractiveHtml(null, page(COUNTER), ALLOWED)).toBeNull();
    expect(
      refusedInteractiveHtml(page(broken), page(broken, COUNTER), ALLOWED),
    ).toBeNull();
    expect(
      refusedInteractiveHtml(
        page(COUNTER),
        page(`<title>Chart</title>${broken}`),
        ALLOWED,
      ),
    ).toMatchObject({ title: "Chart", problems: [expect.any(String)] });
  });

  it("checks another copy of a block that was already broken", () => {
    const broken = '<script src="https://unpkg.com/react"></script>';

    expect(
      refusedInteractiveHtml(page(broken), page(broken, broken), ALLOWED),
    ).toMatchObject({ problems: [expect.any(String)] });
  });

  it("finds a block whatever the spacing or case of its language", () => {
    const body =
      '```HTML   Interactive\n<script src="https://unpkg.com/x"></script>\n```';

    expect(refusedInteractiveHtml(null, body, ALLOWED)).not.toBeNull();
  });
});
