// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  absolutizeCssUrls,
  collectUsedFontSpecs,
  extractFontFaceRules,
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

describe("collectUsedFontSpecs", () => {
  it("returns one loadable shorthand per distinct text style", () => {
    document.body.innerHTML = `
      <h1 style="font-family: Neuron; font-weight: 700; font-size: 48px">Reimagined</h1>
      <p style="font-family: Neuron; font-weight: 700; font-size: 48px">Same style</p>
      <p style="font-family: Neuron; font-weight: 400; font-size: 16px">Body copy</p>
      <div style="font-family: Neuron"><span>nested only</span></div>`;

    const specs = collectUsedFontSpecs(document);

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
