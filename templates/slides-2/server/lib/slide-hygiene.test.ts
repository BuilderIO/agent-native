import { describe, expect, it } from "vitest";

import {
  lintSlideHtml,
  slideHygieneReport,
  type SlideHygieneCode,
} from "./slide-hygiene.js";

const slide = (body: string) =>
  `<div class="fmd-slide" style="padding: 64px 80px;">${body}</div>`;

const codes = (html: string, previousHtml?: string) =>
  lintSlideHtml(html, { previousHtml }).map((w) => w.code);

const positive: Array<[SlideHygieneCode, string, string]> = [
  [
    "inline-svg",
    "svg",
    slide('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>'),
  ],
  ["stripped-element", "button", slide("<button>Buy now</button>")],
  ["stripped-element", "script", slide("<script>alert(1)</script><p>Hi</p>")],
  [
    "stripped-attribute",
    "onclick",
    slide('<div onclick="go()">Hi there</div>'),
  ],
  [
    "stripped-attribute",
    "srcset",
    slide('<img src="https://x.test/a.png" srcset="a 1x">'),
  ],
  ["stripped-url", "javascript", slide('<a href="javascript:void(0)">Go</a>')],
  ["stripped-url", "protocol-relative", slide('<img src="//cdn.test/a.png">')],
  [
    "stripped-url",
    "svg data",
    slide('<img src="data:image/svg+xml;base64,AAAA">'),
  ],
  [
    "stripped-style",
    "background url",
    slide(
      '<div style="background: url(https://x.test/a.png) center;">Hello</div>',
    ),
  ],
  [
    "stripped-style",
    "style block",
    slide(
      '<style>.card { background-image: url(x.png); }</style><div class="card">Hi</div>',
    ),
  ],
  [
    "stripped-style",
    "@import",
    slide("<style>@import url(https://f.test/x.css);</style><p>Hi</p>"),
  ],
  [
    "unwrapped-element",
    "nav",
    slide('<nav style="display:flex;gap:8px">Home</nav>'),
  ],
  [
    "typed-page-number",
    "04 / 12 in footer",
    slide(
      '<footer style="position:absolute;bottom:24px;right:32px">04 / 12</footer>',
    ),
  ],
  ["typed-page-number", "3 of 12", slide('<div class="footer">3 of 12</div>')],
  [
    "typed-page-number",
    "bare number, absolute bottom",
    slide('<div style="position:absolute;bottom:20px;right:20px;">07</div>'),
  ],
  [
    "typed-page-number",
    "typed total after token",
    slide("<footer><span data-slide-number></span> / 12</footer>"),
  ],
  [
    "typed-page-number",
    "padded pair in a running head",
    slide('<div style="font-size:14px">03 / 06</div>'),
  ],
  [
    "fixed-height-text",
    "card",
    slide(
      '<div style="height: 180px; background: #eee;"><h3>Pricing</h3><p>Everything you need to get started with the team.</p></div>',
    ),
  ],
  [
    "stripped-style",
    "gradient text fill",
    slide(
      '<h1 style="background:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">Hello</h1>',
    ),
  ],
  [
    "stripped-style",
    "prefixed property in a style block",
    slide(
      '<style>.t { -webkit-text-fill-color: transparent; }</style><p class="t">Hi</p>',
    ),
  ],
  [
    "fixed-height-text",
    "prefixed line-clamp does not survive sanitizing",
    slide(
      '<p style="height:60px;-webkit-line-clamp:3;display:-webkit-box">A long enough sentence that would be clamped to three lines in a card.</p>',
    ),
  ],
  ["typed-page-number", "spaced padded pair", slide("<div>03 / 15</div>")],
  [
    "contain-property",
    "contain",
    slide('<div style="contain: layout paint;">Some text</div>'),
  ],
  [
    "contain-property",
    "contain-intrinsic-size",
    slide('<div style="contain-intrinsic-size: 100px 200px;">Some text</div>'),
  ],
  [
    "stacked-absolute-text",
    "two labels over a card",
    slide(
      '<div style="position:relative;background:#111;border-radius:8px;height:120px"><div style="position:absolute;left:12px;top:12px">Revenue</div><div style="position:absolute;left:12px;top:60px">$4.2M</div></div>',
    ),
  ],
  [
    "small-text",
    "10px label",
    slide('<p style="font-size: 10px;">Source: internal</p>'),
  ],
  [
    "small-text",
    "13px running copy",
    slide(`<p style="font-size: 13px;">${"word ".repeat(20)}</p>`),
  ],
  [
    "deep-nesting",
    "ten levels",
    slide(
      Array.from({ length: 9 }, () => "<div>").join("") +
        "deep" +
        "</div>".repeat(9),
    ),
  ],
];

const negative: Array<[string, string]> = [
  [
    "plain img",
    slide(
      '<img src="https://x.test/a.png" alt="a" style="width:200px;height:120px">',
    ),
  ],
  ["png data url", slide('<img src="data:image/png;base64,iVBORw0KGgo=">')],
  ["https link", slide('<a href="https://x.test">Link</a>')],
  [
    "gradient background",
    slide(
      '<div style="background: linear-gradient(135deg, #111, #333);">Hi there</div>',
    ),
  ],
  [
    "supported tags only",
    slide(
      "<section><h2>Title</h2><ul><li>One</li></ul><blockquote>Quote</blockquote></section>",
    ),
  ],
  [
    "slide-number tokens",
    slide(
      '<footer style="position:absolute;bottom:24px"><span data-slide-number="pad"></span> / <span data-slide-total="pad"></span></footer>',
    ),
  ],
  [
    "index number outside a footer",
    slide('<div style="font-size:96px">01</div><h2>Overview</h2>'),
  ],
  ["score in a body card", slide("<div>3 / 5</div>")],
  [
    "min-height card",
    slide(
      '<div style="min-height: 180px;"><h3>Pricing</h3><p>Everything you need to get started.</p></div>',
    ),
  ],
  [
    "badge with fixed box",
    slide(
      '<div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center">01</div>',
    ),
  ],
  [
    "single-line pill",
    slide(
      '<span style="display:inline-flex;height:28px;align-items:center">Beta preview</span>',
    ),
  ],
  [
    "divider without text",
    slide('<div style="height: 2px; background: #ccc;"></div>'),
  ],
  [
    "percent height",
    slide(
      '<div style="height: 100%;"><p>Fill the slide with text content</p></div>',
    ),
  ],
  [
    "decorative aria-hidden box",
    slide('<div aria-hidden="true" style="height:300px">decor text</div>'),
  ],
  [
    "hand-placed text box",
    slide(
      '<div class="fmd-text-box" data-slide-object-id="o1" style="position:absolute;left:10px;top:10px;width:300px;height:200px">Long editable text goes here</div>',
    ),
  ],
  [
    "placeholder",
    slide(
      '<div class="fmd-img-placeholder" style="height: 220px;">Q3 revenue chart</div>',
    ),
  ],
  [
    "canvas diagram with absolute children",
    slide(
      '<div style="position:relative;height:300px"><div style="position:absolute;left:0;top:0">Node A</div></div>',
    ),
  ],
  [
    "slide root height",
    '<div class="fmd-slide" style="height: 540px; padding: 64px;"><p>Hello there, world</p></div>',
  ],
  [
    "sized absolute object",
    slide(
      '<div style="position:absolute;left:0;top:0;width:250px;height:350px">Image placeholder caption</div>',
    ),
  ],
  [
    "chart labels placed with percentages",
    slide(
      '<div style="position:relative;background:#111;height:120px"><div style="position:absolute;left:10%;top:4px">Q1</div><div style="position:absolute;left:60%;top:4px">Q2</div></div>',
    ),
  ],
  [
    "bordered row with text",
    slide(
      '<div style="border-top:1px solid #ccc"><div style="position:absolute;left:0;top:0">Cost</div><div style="position:absolute;left:100px;top:0">$5</div></div>',
    ),
  ],
  ["contain none", slide('<div style="contain: none;">Some text</div>')],
  [
    "single absolute label over a card",
    slide(
      '<div style="position:relative;background:#111"><div style="position:absolute;top:8px">Tag</div></div>',
    ),
  ],
  [
    "hand-placed objects over a card",
    slide(
      '<div style="background:#111"><div data-slide-object-id="a" style="position:absolute">One</div><div data-slide-object-id="b" style="position:absolute">Two</div></div>',
    ),
  ],
  ["12px label", slide('<p style="font-size: 12px;">Source: internal</p>')],
  [
    "relative font size",
    slide('<p style="font-size: 0.7em;">tiny but relative</p>'),
  ],
  [
    "inherited large size",
    slide(
      '<div style="font-size: 20px;"><p>Some inherited text that is long enough to count as running copy.</p></div>',
    ),
  ],
  [
    "inline chain depth",
    slide(`<p>${"<span>".repeat(14)}x${"</span>".repeat(14)}</p>`),
  ],
  [
    "footnote marker",
    slide('<p class="footnote"><sup>1</sup> Source: Gartner 2025</p>'),
  ],
  [
    "footnote box stat",
    slide('<div class="footnote-box"><span>7</span> of 10 teams</div>'),
  ],
  [
    "bottom-edge stat with a label",
    slide(
      '<div style="position:absolute;left:0;bottom:24px"><b>3</b><span>teams shipped</span></div>',
    ),
  ],
  ["table date", slide("<table><tr><td>03/15</td></tr></table>")],
  ["timeline date", slide("<div>09/30</div>")],
  [
    "bottom-edge list",
    slide(
      '<ol style="position:absolute;left:0;bottom:10px"><li>1</li><li>2</li></ol>',
    ),
  ],
  ["footer list item", slide("<footer><ul><li>2</li></ul></footer>")],
  [
    "labelled chart panel",
    slide(
      '<div style="position:relative;background:#123;width:400px;height:200px"><span style="position:absolute;left:4px;top:4px">Revenue</span><span style="position:absolute;left:4px;top:100px">Cost</span></div>',
    ),
  ],
  [
    "chart panel with drawn bars",
    slide(
      '<div style="position:relative;background:#123"><div style="position:absolute;left:10px;top:40px;width:20px;height:60px;background:#0f0"></div><span style="position:absolute;left:4px;top:4px">Revenue</span><span style="position:absolute;left:4px;top:100px">Cost</span></div>',
    ),
  ],
  [
    "imported pptx skips layout lint",
    '<div class="fmd-slide" data-imported-pptx="true"><div style="height:200px">Imported text box content</div></div>',
  ],
];

describe("lintSlideHtml", () => {
  it.each(positive)("%s: %s", (code, _label, html) => {
    expect(codes(html)).toContain(code);
  });

  it.each(negative)("is quiet for %s", (_label, html) => {
    expect(codes(html)).toEqual([]);
  });

  it("keeps sanitizer-loss checks on imported slides", () => {
    expect(
      codes(
        '<div class="fmd-slide" data-imported-pptx="true"><svg></svg></div>',
      ),
    ).toEqual(["inline-svg"]);
  });

  it("groups repeats into one warning with a count", () => {
    const warnings = lintSlideHtml(
      slide("<svg></svg><p>x</p><svg></svg><svg></svg>"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: "inline-svg",
      severity: "error",
      count: 3,
    });
    expect(warnings[0].message).toMatch(/<svg>/);
  });

  it("names the removed elements in the message", () => {
    const [warning] = lintSlideHtml(
      slide("<button>A</button><iframe src='https://x.test'></iframe>"),
    );
    expect(warning.message).toContain("<button>");
    expect(warning.message).toContain("<iframe>");
    expect(warning.count).toBe(2);
  });

  it("reports only what an edit introduced", () => {
    const before = slide(
      '<svg></svg><div style="height:200px"><p>Existing card text here</p></div>',
    );
    // Same problems, different unrelated text: nothing new.
    expect(
      codes(before.replace("padding: 64px", "padding: 48px"), before),
    ).toEqual([]);
    const after = before.replace(
      "</div></div>",
      "</div><button>Go</button></div>",
    );
    expect(codes(after, before)).toEqual(["stripped-element"]);
  });

  it("reports nothing for an unchanged slide", () => {
    const html = slide("<svg></svg>");
    expect(codes(html, html)).toEqual([]);
  });

  it("has no snippet longer than a line", () => {
    const [warning] = lintSlideHtml(
      slide(`<div style="height:300px">${"long text ".repeat(50)}</div>`),
    );
    expect(warning.snippet.length).toBeLessThan(200);
  });
});

describe("slideHygieneReport", () => {
  it("is undefined for clean slides", () => {
    expect(
      slideHygieneReport([{ slideId: "s1", html: slide("<p>Hello</p>") }]),
    ).toBeUndefined();
  });

  it("merges one code across slides and lists the slides", () => {
    const report = slideHygieneReport([
      { slideId: "s1", html: slide("<svg></svg>") },
      { slideId: "s2", html: slide("<p>ok</p>") },
      { slideId: "s3", html: slide("<svg></svg><svg></svg>") },
    ]);
    expect(report?.warnings).toHaveLength(1);
    expect(report?.warnings[0]).toMatchObject({
      code: "inline-svg",
      count: 3,
      slideIds: ["s1", "s3"],
    });
  });

  it("orders errors before warnings and caps the list", () => {
    const report = slideHygieneReport([
      {
        slideId: "s1",
        html: slide(
          '<p style="font-size:10px">tiny text</p><div style="contain: paint">x text</div><svg></svg>',
        ),
      },
    ]);
    expect(report?.warnings.map((w) => w.code)).toEqual([
      "inline-svg",
      "small-text",
      "contain-property",
    ]);
  });

  it("reports a lint failure instead of looking clean", () => {
    const report = slideHygieneReport([
      { slideId: "s1", html: { toString: () => "" } as unknown as string },
    ]);
    expect(report?.warnings[0].code).toBe("hygiene-lint-failed");
  });
});
