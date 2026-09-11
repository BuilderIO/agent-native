// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  absolutizeCssUrls,
  collectFontRequests,
  extractFontFaceRules,
  extractImportUrls,
  stripCssComments,
  mirrorPreviewWebFonts,
} from "./export-font-mirror";

describe("absolutizeCssUrls", () => {
  it("resolves relative font urls against the stylesheet", () => {
    expect(
      absolutizeCssUrls(
        "src: url(../files/inter.woff2) format('woff2');",
        "https://cdn.example.com/css/fonts.css",
      ),
    ).toContain("https://cdn.example.com/files/inter.woff2");
  });

  it("leaves inline and unresolvable urls untouched", () => {
    const css = "src: url(data:font/woff2;base64,AAAA);";
    expect(absolutizeCssUrls(css, "https://cdn.example.com/a.css")).toBe(css);
  });
});

describe("extractFontFaceRules", () => {
  it("keeps only @font-face blocks so design CSS cannot restyle the editor", () => {
    const rules = extractFontFaceRules(
      `body { background: red; }
       @font-face { font-family: "Neuron"; src: url(a.woff2); }
       .headline { color: blue; }
       @media (min-width: 40rem) { .x { color: green; } }
       @font-face { font-family: 'Neuron Mono'; src: url("b.woff2"); }`,
      "https://cdn.example.com/fonts.css",
    );
    expect(rules).toHaveLength(2);
    expect(rules.join("\n")).not.toContain("background: red");
    expect(rules[0]).toContain("https://cdn.example.com/a.woff2");
    expect(rules[1]).toContain("https://cdn.example.com/b.woff2");
  });

  it("does not end a rule on a brace inside a quoted value", () => {
    const rules = extractFontFaceRules(
      `@font-face { font-family: "Od{d}"; src: url(a.woff2); } .after { color: red }`,
      "https://cdn.example.com/f.css",
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('font-family: "Od{d}"');
    expect(rules[0]).not.toContain(".after");
  });

  it("ignores an unterminated rule rather than emitting a truncated one", () => {
    expect(
      extractFontFaceRules("@font-face { font-family: 'X';", "https://e.com/"),
    ).toEqual([]);
  });
});

describe("collectFontRequests", () => {
  it("returns one loadable shorthand per distinct text style", () => {
    document.body.innerHTML = `
      <h1 style="font-family: Neuron; font-weight: 700; font-size: 48px">Reimagined</h1>
      <p style="font-family: Neuron; font-weight: 700; font-size: 48px">Same style</p>
      <p style="font-family: Neuron; font-weight: 400; font-size: 16px">Body copy</p>
      <div style="font-family: Neuron"><span>nested only</span></div>`;

    const specs = collectFontRequests(document).map((r) => r.spec);

    expect(specs.some((spec) => spec.includes("700 48px"))).toBe(true);
    expect(specs.some((spec) => spec.includes("400 16px"))).toBe(true);
    // The wrapper <div> holds no direct text, so it contributes no spec.
    expect(specs.filter((spec) => spec.includes("Neuron"))).toHaveLength(
      new Set(specs.filter((spec) => spec.includes("Neuron"))).size,
    );
  });
});

describe("mirrorPreviewWebFonts", () => {
  it("injects the preview's faces into the target and removes them on dispose", async () => {
    const preview = document.implementation.createHTMLDocument("preview");
    const style = preview.createElement("style");
    style.textContent = `@font-face { font-family: "Neuron"; src: url("https://cdn.example.com/n.woff2"); }`;
    preview.head.appendChild(style);
    preview.body.innerHTML = `<h1 style="font-family: Neuron; font-size: 48px">Hi</h1>`;

    const target = document.implementation.createHTMLDocument("editor");
    const mirrored = await mirrorPreviewWebFonts(preview, target);

    expect(mirrored.faceCount).toBe(1);
    const injected = target.head.querySelector(
      "style[data-agent-native-export-fontface]",
    );
    expect(injected?.textContent).toContain("Neuron");

    mirrored.dispose();
    expect(
      target.head.querySelector("style[data-agent-native-export-fontface]"),
    ).toBeNull();
  });

  it("reports a font stylesheet it could not read instead of dropping it silently", async () => {
    const preview = document.implementation.createHTMLDocument("preview");
    const href = "https://fonts.googleapis.com/css2?family=Neuron";
    Object.defineProperty(preview, "styleSheets", {
      value: [
        {
          href,
          get cssRules(): never {
            throw new DOMException("cross-origin", "SecurityError");
          },
        },
      ],
    });
    const failingFetch = () => Promise.reject(new Error("offline"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = failingFetch as typeof fetch;
    try {
      const target = document.implementation.createHTMLDocument("editor");
      const mirrored = await mirrorPreviewWebFonts(preview, target);
      expect(mirrored.unreadableStylesheets).toEqual([href]);
      expect(mirrored.faceCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("mirrors faces recovered from a cross-origin font stylesheet", async () => {
    const preview = document.implementation.createHTMLDocument("preview");
    const href = "https://fonts.googleapis.com/css2?family=Neuron";
    Object.defineProperty(preview, "styleSheets", {
      value: [
        {
          href,
          get cssRules(): never {
            throw new DOMException("cross-origin", "SecurityError");
          },
        },
      ],
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () =>
          Promise.resolve(
            `@font-face { font-family: 'Neuron'; src: url(/s/neuron.woff2); }`,
          ),
      })) as unknown as typeof fetch;
    try {
      const target = document.implementation.createHTMLDocument("editor");
      const mirrored = await mirrorPreviewWebFonts(preview, target);
      expect(mirrored.unreadableStylesheets).toEqual([]);
      expect(mirrored.faceCount).toBe(1);
      expect(
        target.head.querySelector("style[data-agent-native-export-fontface]")
          ?.textContent,
      ).toContain("https://fonts.googleapis.com/s/neuron.woff2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * `@import url('https://fonts.googleapis.com/...')` inside a <style> block is
 * a normal way for a generated design to pull webfonts, and those faces hang
 * off CSSImportRule.styleSheet rather than the top-level rule list.
 */
describe("mirrorPreviewWebFonts nested stylesheets", () => {
  const FONT_FACE_RULE = 5;
  const IMPORT_RULE = 3;
  const MEDIA_RULE = 4;

  function previewWithSheets(sheets: unknown[]): Document {
    const preview = document.implementation.createHTMLDocument("preview");
    Object.defineProperty(preview, "styleSheets", { value: sheets });
    return preview;
  }

  it("follows a readable @import to the faces inside it", async () => {
    const imported = {
      href: "https://cdn.example.com/nested/fonts.css",
      cssRules: [
        {
          type: FONT_FACE_RULE,
          cssText: `@font-face { font-family: "Imported"; src: url(i.woff2); }`,
        },
      ],
    };
    const preview = previewWithSheets([
      {
        href: null,
        cssRules: [
          { type: IMPORT_RULE, href: "nested/fonts.css", styleSheet: imported },
        ],
      },
    ]);

    const target = document.implementation.createHTMLDocument("editor");
    const mirrored = await mirrorPreviewWebFonts(preview, target);

    expect(mirrored.faceCount).toBe(1);
    expect(mirrored.unreadableStylesheets).toEqual([]);
    expect(
      target.head.querySelector("style[data-agent-native-export-fontface]")
        ?.textContent,
    ).toContain("https://cdn.example.com/nested/i.woff2");
  });

  it("reports a cross-origin @import instead of mirroring an empty sheet", async () => {
    const href = "https://fonts.googleapis.com/css2?family=Neuron";
    const preview = previewWithSheets([
      {
        href: null,
        cssRules: [
          {
            type: IMPORT_RULE,
            href,
            get styleSheet(): never {
              throw new DOMException("cross-origin", "SecurityError");
            },
          },
        ],
      },
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    try {
      const target = document.implementation.createHTMLDocument("editor");
      const mirrored = await mirrorPreviewWebFonts(preview, target);
      expect(mirrored.faceCount).toBe(0);
      expect(mirrored.unreadableStylesheets).toEqual([href]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("finds faces nested in a grouping rule", async () => {
    const preview = previewWithSheets([
      {
        href: "https://cdn.example.com/a.css",
        cssRules: [
          {
            type: MEDIA_RULE,
            cssRules: [
              {
                type: FONT_FACE_RULE,
                cssText: `@font-face { font-family: "Grouped"; src: url(g.woff2); }`,
              },
            ],
          },
        ],
      },
    ]);

    const target = document.implementation.createHTMLDocument("editor");
    expect((await mirrorPreviewWebFonts(preview, target)).faceCount).toBe(1);
  });

  it("terminates on a self-referencing @import", async () => {
    const sheet: Record<string, unknown> = {
      href: "https://cdn.example.com/loop.css",
    };
    sheet.cssRules = [
      { type: IMPORT_RULE, href: "loop.css", styleSheet: sheet },
      {
        type: FONT_FACE_RULE,
        cssText: `@font-face { font-family: "Loop"; src: url(l.woff2); }`,
      },
    ];
    const preview = previewWithSheets([sheet]);

    const target = document.implementation.createHTMLDocument("editor");
    expect((await mirrorPreviewWebFonts(preview, target)).faceCount).toBe(1);
  });

  it("reports an imported sheet whose rules cannot be read", async () => {
    const href = "https://cdn.example.com/opaque.css";
    const preview = previewWithSheets([
      {
        href: null,
        cssRules: [
          {
            type: IMPORT_RULE,
            href,
            styleSheet: {
              href,
              get cssRules(): never {
                throw new DOMException("cross-origin", "SecurityError");
              },
            },
          },
        ],
      },
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    try {
      const target = document.implementation.createHTMLDocument("editor");
      const mirrored = await mirrorPreviewWebFonts(preview, target);
      expect(mirrored.faceCount).toBe(0);
      expect(mirrored.unreadableStylesheets).toEqual([href]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * html2canvas turns `::before` / `::after` into real painted elements
 * (`DocumentCloner.resolvePseudoContent`), so a font used only by generated
 * content still has to be requested in the document that owns the canvas.
 *
 * happy-dom does not implement pseudo-element computed styles (`content` comes
 * back empty), so these drive a stubbed view: they pin that the walk asks for
 * pseudo styles and uses them, which is the logic this module owns. The
 * end-to-end behaviour is covered by the Chromium harness.
 */
describe("collectFontRequests generated content", () => {
  function docWithComputedStyles(
    html: string,
    styles: (
      element: Element,
      pseudo?: string | null,
    ) => Record<string, string>,
  ): Document {
    const doc = document.implementation.createHTMLDocument("preview");
    doc.body.innerHTML = html;
    Object.defineProperty(doc, "defaultView", {
      value: {
        getComputedStyle: (element: Element, pseudo?: string | null) =>
          styles(element, pseudo) as unknown as CSSStyleDeclaration,
      },
    });
    return doc;
  }

  it("requests the font of an icon pseudo-element with no host text", () => {
    const doc = docWithComputedStyles(`<i class="icon"></i>`, (_el, pseudo) =>
      pseudo === "::before"
        ? {
            content: '"\\f0c7"',
            fontFamily: '"IconFont"',
            fontSize: "20px",
            fontWeight: "700",
            fontStyle: "normal",
          }
        : {
            content: "none",
            fontFamily: "Inter",
            fontSize: "16px",
            fontWeight: "400",
            fontStyle: "normal",
          },
    );

    const specs = collectFontRequests(doc).map((r) => r.spec);

    expect(specs).toEqual(['normal 700 20px "IconFont"']);
  });

  /**
   * Chromium substitutes `attr()` into the computed `content`, but an engine
   * that leaves it unresolved used to yield an empty sample, so a private-use
   * icon subset was never requested and the raster fell back.
   */
  it("resolves attr() content against the host element", () => {
    const glyph = String.fromCodePoint(0xe001);
    const doc = docWithComputedStyles(
      `<i class="icon" data-icon="DATA_GLYPH"></i>`.replace(
        "DATA_GLYPH",
        glyph,
      ),
      (_el, pseudo) =>
        pseudo === "::before"
          ? {
              content: "attr(data-icon)",
              fontFamily: '"IconFont"',
              fontSize: "20px",
              fontWeight: "400",
              fontStyle: "normal",
            }
          : {
              content: "none",
              fontFamily: "Inter",
              fontSize: "16px",
              fontWeight: "400",
              fontStyle: "normal",
            },
    );

    expect(collectFontRequests(doc)).toEqual([
      { spec: 'normal 400 20px "IconFont"', text: glyph },
    ]);
  });

  it("ignores pseudo-elements with no painted content", () => {
    const doc = docWithComputedStyles(`<i class="plain"></i>`, () => ({
      content: "none",
      fontFamily: '"Ghost"',
      fontSize: "16px",
      fontWeight: "400",
      fontStyle: "normal",
    }));

    expect(collectFontRequests(doc)).toEqual([]);
  });

  it("skips elements that hold text but paint none of it", () => {
    document.head.innerHTML = "";
    document.body.innerHTML = `<div><style>.x { color: red }</style><script>var a = 1;</script></div>`;

    expect(collectFontRequests(document)).toEqual([]);
  });
});

describe("extractImportUrls", () => {
  it("resolves url() and bare-string imports", () => {
    expect(
      extractImportUrls(
        `@import url("a.css"); @import 'b.css'; @import url(c.css) screen;`,
        "https://cdn.example.com/css/main.css",
      ),
    ).toEqual({
      urls: [
        { href: "https://cdn.example.com/css/a.css", media: "", supports: "" },
        { href: "https://cdn.example.com/css/b.css", media: "", supports: "" },
        {
          href: "https://cdn.example.com/css/c.css",
          media: "screen",
          supports: "",
        },
      ],
      unresolvable: [],
    });
  });

  it("returns an unresolvable target instead of dropping it", () => {
    expect(extractImportUrls(`@import url("a.css");`, "not a base")).toEqual({
      urls: [],
      unresolvable: ["a.css"],
    });
  });
});

describe("mirrorPreviewWebFonts import chains and budget", () => {
  function crossOriginPreview(href: string): Document {
    const preview = document.implementation.createHTMLDocument("preview");
    Object.defineProperty(preview, "styleSheets", {
      value: [
        {
          href,
          get cssRules(): never {
            throw new DOMException("cross-origin", "SecurityError");
          },
        },
      ],
    });
    return preview;
  }

  it("follows an @import inside a fetched stylesheet", async () => {
    const outer = "https://fonts.example.com/outer.css";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () =>
          Promise.resolve(
            String(url).includes("outer")
              ? `@import url("nested/inner.css");`
              : `@font-face { font-family: "Inner"; src: url(i.woff2); }`,
          ),
      })) as unknown as typeof fetch;
    try {
      const target = document.implementation.createHTMLDocument("editor");
      const mirrored = await mirrorPreviewWebFonts(
        crossOriginPreview(outer),
        target,
      );
      expect(mirrored.faceCount).toBe(1);
      expect(mirrored.unreadableStylesheets).toEqual([]);
      expect(
        target.head.querySelector("style[data-agent-native-export-fontface]")
          ?.textContent,
      ).toContain("https://fonts.example.com/nested/i.woff2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports an unreachable nested import rather than losing it", async () => {
    const outer = "https://fonts.example.com/outer.css";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) =>
      String(url).includes("outer")
        ? Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            text: () => Promise.resolve(`@import url("inner.css");`),
          })
        : Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    try {
      const mirrored = await mirrorPreviewWebFonts(
        crossOriginPreview(outer),
        document.implementation.createHTMLDocument("editor"),
      );
      expect(mirrored.faceCount).toBe(0);
      expect(mirrored.unreadableStylesheets).toEqual([
        "https://fonts.example.com/inner.css",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("terminates on an import cycle between fetched sheets", async () => {
    const outer = "https://fonts.example.com/a.css";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () =>
          Promise.resolve(
            String(url).includes("a.css")
              ? `@import url("b.css"); @font-face { font-family: "A"; src: url(a.woff2); }`
              : `@import url("a.css");`,
          ),
      })) as unknown as typeof fetch;
    try {
      const mirrored = await mirrorPreviewWebFonts(
        crossOriginPreview(outer),
        document.implementation.createHTMLDocument("editor"),
      );
      expect(mirrored.faceCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("spends one shared budget across fetching and font loading", async () => {
    const outer = "https://fonts.example.com/slow.css";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      new Promise(() => {
        // Never settles; the shared deadline has to end this phase.
      })) as unknown as typeof fetch;
    try {
      const started = Date.now();
      await mirrorPreviewWebFonts(
        crossOriginPreview(outer),
        document.implementation.createHTMLDocument("editor"),
        { timeoutMs: 300 },
      );
      // Two independent windows would take ~600ms here.
      expect(Date.now() - started).toBeLessThan(520);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("mirrorPreviewWebFonts grouping conditions", () => {
  const FONT_FACE_RULE = 5;
  const MEDIA_RULE = 4;

  function previewWithMedia(mediaText: string, matches: boolean): Document {
    const preview = document.implementation.createHTMLDocument("preview");
    Object.defineProperty(preview, "styleSheets", {
      value: [
        {
          href: "https://cdn.example.com/a.css",
          cssRules: [
            {
              type: MEDIA_RULE,
              media: { mediaText },
              cssRules: [
                {
                  type: FONT_FACE_RULE,
                  cssText: `@font-face { font-family: "Conditional"; src: url(c.woff2); }`,
                },
              ],
            },
          ],
        },
      ],
    });
    Object.defineProperty(preview, "defaultView", {
      value: { matchMedia: () => ({ matches }) },
    });
    return preview;
  }

  it("mirrors a face whose condition matches in the preview", async () => {
    const mirrored = await mirrorPreviewWebFonts(
      previewWithMedia("screen", true),
      document.implementation.createHTMLDocument("editor"),
    );
    expect(mirrored.faceCount).toBe(1);
  });

  it("skips a face the preview never activated", async () => {
    const mirrored = await mirrorPreviewWebFonts(
      previewWithMedia("print", false),
      document.implementation.createHTMLDocument("editor"),
    );
    expect(mirrored.faceCount).toBe(0);
  });
});

describe("stripCssComments", () => {
  it("removes comments but leaves string literals alone", () => {
    expect(
      stripCssComments(
        `a { content: "/* not a comment */"; } /* gone */ b { color: red }`,
      ),
    ).toBe(`a { content: "/* not a comment */"; }   b { color: red }`);
  });

  it("drops an unterminated comment to the end of the sheet", () => {
    expect(stripCssComments(`a { color: red } /* trailing`).trim()).toBe(
      "a { color: red }",
    );
  });
});

/**
 * A brace inside a comment used to unbalance the brace scan, so the captured
 * "@font-face" block ran on through the following rules and carried ordinary
 * layout CSS into the editor document - the one thing this module must never
 * do, since that stylesheet is live in the app while the capture runs.
 */
describe("extractFontFaceRules hostile input", () => {
  it("does not capture following rules when a comment contains a brace", () => {
    const rules = extractFontFaceRules(
      `@font-face { font-family: "Real"; /* { */ src: url(r.woff2) }
       body { display: none }`,
      "https://cdn.example.com/a.css",
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain("Real");
    expect(rules.join("\n")).not.toContain("display: none");
  });

  it("ignores a commented-out face so no request is made for it", () => {
    expect(
      extractFontFaceRules(
        `/* @font-face { font-family: "Commented"; src: url(c.woff2) } */`,
        "https://cdn.example.com/a.css",
      ),
    ).toEqual([]);
  });
});

describe("extractFontFaceRules conditional groups", () => {
  const css = `@media print { @font-face { font-family: "PrintOnly"; src: url(p.woff2) } }
    @supports (display: grid) { @font-face { font-family: "Supported"; src: url(s.woff2) } }
    @layer fonts { @font-face { font-family: "Layered"; src: url(l.woff2) } }
    @font-face { font-family: "Always"; src: url(a.woff2) }`;

  it("keeps only the groups that applied in the preview", () => {
    const rules = extractFontFaceRules(
      css,
      "https://cdn.example.com/a.css",
      (kind, condition) =>
        kind === "media"
          ? condition !== "print"
          : condition === "(display: grid)",
    );
    const families = rules.join("\n");
    expect(families).not.toContain("PrintOnly");
    expect(families).toContain("Supported");
    expect(families).toContain("Layered");
    expect(families).toContain("Always");
  });

  it("keeps every group when no filter is supplied", () => {
    expect(
      extractFontFaceRules(css, "https://cdn.example.com/a.css"),
    ).toHaveLength(4);
  });
});

describe("extractImportUrls media", () => {
  it("separates the media query from layer() and supports()", () => {
    expect(
      extractImportUrls(
        `@import url("a.css") layer(base) supports(display: grid) print;`,
        "https://cdn.example.com/x.css",
      ).urls,
    ).toEqual([
      {
        href: "https://cdn.example.com/a.css",
        media: "print",
        supports: "display: grid",
      },
    ]);
  });

  /**
   * A `[^)]*` strip stopped at the inner `)`, leaving
   * `or (display:flex)) screen` as the media query. That matches nothing, so a
   * real screen import was dropped for the wrong reason.
   */
  it("balances parentheses inside supports()", () => {
    expect(
      extractImportUrls(
        `@import url("a.css") supports((display:grid) or (display:flex)) screen;`,
        "https://cdn.example.com/x.css",
      ).urls,
    ).toEqual([
      {
        href: "https://cdn.example.com/a.css",
        media: "screen",
        supports: "(display:grid) or (display:flex)",
      },
    ]);
  });

  it("ignores a commented-out import", () => {
    expect(
      extractImportUrls(
        `/* @import url("a.css"); */`,
        "https://cdn.example.com/x.css",
      ).urls,
    ).toEqual([]);
  });
});

describe("mirrorPreviewWebFonts import media", () => {
  const FONT_FACE_RULE = 5;
  const IMPORT_RULE = 3;

  it("does not follow a print-only @import for a screen preview", async () => {
    const imported = {
      href: "https://cdn.example.com/print.css",
      cssRules: [
        {
          type: FONT_FACE_RULE,
          cssText: `@font-face { font-family: "PrintOnly"; src: url(p.woff2) }`,
        },
      ],
    };
    const preview = document.implementation.createHTMLDocument("preview");
    Object.defineProperty(preview, "styleSheets", {
      value: [
        {
          href: null,
          cssRules: [
            {
              type: IMPORT_RULE,
              href: "print.css",
              media: { mediaText: "print" },
              styleSheet: imported,
            },
          ],
        },
      ],
    });
    Object.defineProperty(preview, "defaultView", {
      value: {
        matchMedia: (query: string) => ({ matches: query !== "print" }),
      },
    });

    const mirrored = await mirrorPreviewWebFonts(
      preview,
      document.implementation.createHTMLDocument("editor"),
    );

    expect(mirrored.faceCount).toBe(0);
    expect(mirrored.unreadableStylesheets).toEqual([]);
  });

  it("does not fetch a print-only @import found in fetched text", async () => {
    const outer = "https://fonts.example.com/outer.css";
    const requested: string[] = [];
    const preview = document.implementation.createHTMLDocument("preview");
    Object.defineProperty(preview, "styleSheets", {
      value: [
        {
          href: outer,
          get cssRules(): never {
            throw new DOMException("cross-origin", "SecurityError");
          },
        },
      ],
    });
    Object.defineProperty(preview, "defaultView", {
      value: {
        matchMedia: (query: string) => ({ matches: query !== "print" }),
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      requested.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(`@import url("print.css") print;`),
      });
    }) as unknown as typeof fetch;
    try {
      const mirrored = await mirrorPreviewWebFonts(
        preview,
        document.implementation.createHTMLDocument("editor"),
      );
      expect(requested).toEqual([outer]);
      expect(mirrored.faceCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not fetch an @import behind an unsupported supports()", async () => {
    const outer = "https://fonts.example.com/outer.css";
    const requested: string[] = [];
    const preview = document.implementation.createHTMLDocument("preview");
    Object.defineProperty(preview, "styleSheets", {
      value: [
        {
          href: outer,
          get cssRules(): never {
            throw new DOMException("cross-origin", "SecurityError");
          },
        },
      ],
    });
    Object.defineProperty(preview, "defaultView", {
      value: {
        matchMedia: () => ({ matches: true }),
        CSS: { supports: (condition: string) => condition !== "display: xyz" },
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      requested.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () =>
          Promise.resolve(`@import url("xyz.css") supports(display: xyz);`),
      });
    }) as unknown as typeof fetch;
    try {
      const mirrored = await mirrorPreviewWebFonts(
        preview,
        document.implementation.createHTMLDocument("editor"),
      );
      expect(requested).toEqual([outer]);
      expect(mirrored.faceCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * A stylesheet carries its own media list and `disabled` flag, and both keep it
 * out of the preview's cascade while leaving it in `document.styleSheets`.
 * Mirroring such a sheet would make its faces unconditional in the editor
 * document, where they can outrank the face the preview laid out with.
 */
describe("mirrorPreviewWebFonts stylesheet activation", () => {
  const FONT_FACE_RULE = 5;

  function previewWithSheet(sheet: Record<string, unknown>): Document {
    const preview = document.implementation.createHTMLDocument("preview");
    Object.defineProperty(preview, "styleSheets", { value: [sheet] });
    Object.defineProperty(preview, "defaultView", {
      value: {
        matchMedia: (query: string) => ({ matches: query !== "print" }),
      },
    });
    return preview;
  }

  const printSheet = {
    href: null,
    media: { mediaText: "print" },
    cssRules: [
      {
        type: FONT_FACE_RULE,
        cssText: `@font-face { font-family: "PrintOnly"; src: url(p.woff2) }`,
      },
    ],
  };

  it("skips a print-only stylesheet", async () => {
    const mirrored = await mirrorPreviewWebFonts(
      previewWithSheet(printSheet),
      document.implementation.createHTMLDocument("editor"),
    );

    expect(mirrored.faceCount).toBe(0);
    expect(mirrored.unreadableStylesheets).toEqual([]);
  });

  it("keeps a screen stylesheet", async () => {
    const mirrored = await mirrorPreviewWebFonts(
      previewWithSheet({ ...printSheet, media: { mediaText: "screen" } }),
      document.implementation.createHTMLDocument("editor"),
    );

    expect(mirrored.faceCount).toBe(1);
  });

  it("skips a disabled stylesheet", async () => {
    const mirrored = await mirrorPreviewWebFonts(
      previewWithSheet({ ...printSheet, media: undefined, disabled: true }),
      document.implementation.createHTMLDocument("editor"),
    );

    expect(mirrored.faceCount).toBe(0);
  });

  it("does not fetch a cross-origin stylesheet the preview never applied", async () => {
    const preview = previewWithSheet({
      href: "https://fonts.example.com/print.css",
      media: { mediaText: "print" },
      get cssRules(): never {
        throw new DOMException("cross-origin", "SecurityError");
      },
    });

    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = ((url: string) => {
      requested.push(String(url));
      return Promise.reject(new Error("should not be requested"));
    }) as unknown as typeof fetch;
    try {
      const mirrored = await mirrorPreviewWebFonts(
        preview,
        document.implementation.createHTMLDocument("editor"),
      );
      expect(requested).toEqual([]);
      expect(mirrored.unreadableStylesheets).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * html2canvas paints control values through InputElementContainer and friends
 * without those controls owning a text node, so the walk has to read `.value`
 * or the font rasterizes as fallback.
 */
describe("collectFontRequests form controls", () => {
  function controlDoc(html: string): Document {
    const doc = document.implementation.createHTMLDocument("preview");
    doc.body.innerHTML = html;
    Object.defineProperty(doc, "defaultView", {
      value: {
        getComputedStyle: () =>
          ({
            content: "none",
            fontFamily: '"ControlFont"',
            fontSize: "14px",
            fontWeight: "400",
            fontStyle: "normal",
          }) as unknown as CSSStyleDeclaration,
      },
    });
    return doc;
  }

  it("requests the font of a populated input, textarea and select", () => {
    const doc = controlDoc(
      `<input value="Typed"><textarea>Body</textarea><select><option selected>Chosen</option></select>`,
    );

    const requests = collectFontRequests(doc);

    expect(requests).toHaveLength(1);
    expect(requests[0].spec).toBe('normal 400 14px "ControlFont"');
    for (const character of "TypedBodyChosen") {
      expect(requests[0].text).toContain(character);
    }
  });

  it("ignores an empty control and never samples a password value", () => {
    expect(collectFontRequests(controlDoc(`<input value="">`))).toEqual([]);
    expect(
      collectFontRequests(
        controlDoc(`<input type="password" value="hunter2">`),
      ),
    ).toEqual([]);
  });
});

/**
 * FontFaceSet.load only downloads faces whose unicode-range covers the sample
 * text, and its default sample is a single space. An icon face in the
 * private-use area would never load, so the mirrored face changed nothing.
 */
describe("collectFontRequests sample text", () => {
  function sampleDoc(html: string, family: string): Document {
    const doc = document.implementation.createHTMLDocument("preview");
    doc.body.innerHTML = html;
    Object.defineProperty(doc, "defaultView", {
      value: {
        getComputedStyle: () =>
          ({
            content: "none",
            fontFamily: family,
            fontSize: "16px",
            fontWeight: "400",
            fontStyle: "normal",
          }) as unknown as CSSStyleDeclaration,
      },
    });
    return doc;
  }

  it("carries the distinct painted glyphs and drops whitespace", () => {
    const requests = collectFontRequests(sampleDoc("<p>ab ba</p>", "Inter"));
    expect(requests).toHaveLength(1);
    expect(requests[0].text.split("").sort().join("")).toBe("ab");
  });

  it("falls back to a space when only whitespace is painted", () => {
    const doc = sampleDoc("<p>&nbsp;</p>", "Inter");
    const requests = collectFontRequests(doc);
    expect(requests.every((request) => request.text.length > 0)).toBe(true);
  });

  it("passes the sample text to FontFaceSet.load", async () => {
    const preview = document.implementation.createHTMLDocument("preview");
    const style = preview.createElement("style");
    style.textContent = `@font-face { font-family: "Icons"; src: url("https://cdn.example.com/i.woff2"); }`;
    preview.head.appendChild(style);
    preview.body.innerHTML = `<p>Z</p>`;
    Object.defineProperty(preview, "defaultView", {
      value: {
        getComputedStyle: () =>
          ({
            content: "none",
            fontFamily: '"Icons"',
            fontSize: "16px",
            fontWeight: "400",
            fontStyle: "normal",
          }) as unknown as CSSStyleDeclaration,
      },
    });

    const target = document.implementation.createHTMLDocument("editor");
    const calls: Array<[string, string | undefined]> = [];
    Object.defineProperty(target, "fonts", {
      value: {
        load: (spec: string, text?: string) => {
          calls.push([spec, text]);
          return Promise.resolve([]);
        },
        ready: Promise.resolve(),
      },
    });

    await mirrorPreviewWebFonts(preview, target);

    expect(calls).toEqual([['normal 400 16px "Icons"', "Z"]]);
  });
});
