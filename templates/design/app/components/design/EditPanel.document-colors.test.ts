import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  runSelectionColorChange,
  setSelectionColorPickerSession,
  type SelectionColorPreviewHistoryEntry,
  type SelectionColorPickerSessionEntry,
} from "../../pages/design-editor/commands/selection-color-change";
import {
  replaceSelectionColorsInHtml,
  replaceSelectionFillColorsInHtml,
  rewriteSelectionFillStyles,
  selectionFillAddedStyles,
  selectionFillColorValues,
  selectionFillInspectorStyles,
  selectionFillModel,
  selectionColorTargets,
  selectionColorValues,
} from "./edit-panel/document-colors";
import { extractDocumentColorPalette } from "./EditPanel";
import type { ElementInfo } from "./types";

function fakeElement(computedStyles: Record<string, string>): ElementInfo {
  return {
    tagName: "DIV",
    classes: [],
    computedStyles,
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
  };
}

describe("extractDocumentColorPalette", () => {
  it("collects hex colors from inline styles across multiple files", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content:
          '<div style="color: #FF0000; background-color: #00ff00;"></div>',
      },
      {
        id: "file-2",
        content: '<span style="border-color:#0000FF;"></span>',
      },
    ]);

    expect(palette).toEqual(
      expect.arrayContaining(["#FF0000", "#00FF00", "#0000FF"]),
    );
    expect(palette).toHaveLength(3);
  });

  it("re-reads a file whose bytes changed under the same id and length", () => {
    const red = '<div style="color: #FF0000;"></div>';
    const green = '<div style="color: #00FF00;"></div>';
    const other = { id: "file-2", content: '<p style="color: #0000FF;"></p>' };
    const cache = new Map();
    expect(
      extractDocumentColorPalette(
        [{ id: "file-1", content: red }, other],
        undefined,
        cache,
      ),
    ).toEqual(["#FF0000", "#0000FF"]);
    expect(
      extractDocumentColorPalette(
        [{ id: "file-1", content: green }, other],
        undefined,
        cache,
      ),
    ).toEqual(["#00FF00", "#0000FF"]);
    expect(extractDocumentColorPalette([other], undefined, cache)).toEqual([
      "#0000FF",
    ]);
    expect([...cache.keys()]).toEqual(["file-2"]);
  });

  it("normalizes different formats of the same color to one deduped entry", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content:
          '<div style="color: #ff0000;"></div><div style="color: rgb(255, 0, 0);"></div><div style="color: #f00;"></div>',
      },
    ]);

    expect(palette).toEqual(["#FF0000"]);
  });

  it("parses colors out of <style> blocks, not just inline style attributes", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content:
          "<style>.card { background: hsl(210, 50%, 50%); }</style><div class='card'></div>",
      },
    ]);

    expect(palette).toHaveLength(1);
    expect(palette[0]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("does not treat var() fallbacks as authored document colors", () => {
    const content = `<style>
      body { background: var(--color-bg, #ffffff); color: var(--color-text, #111827); }
    </style><body style="background:#101010"></body>`;

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#101010",
    ]);
    expect(
      selectionColorValues(
        [],
        [{ fileId: "file-1", content, wholeDocument: true }],
      ),
    ).toEqual([{ property: "color", value: "#101010" }]);
  });

  it("does not expose style-block token definitions as selected colors", () => {
    const content = `<style>
      :root { --color-bg: #ffffff; --color-text: #111827; }
      .unused { color: #abcdef; background: #fedcba; }
    </style><body style="background:#101010"></body>`;

    expect(
      selectionColorValues(
        [],
        [{ fileId: "file-1", content, wholeDocument: true }],
      ),
    ).toEqual([{ property: "color", value: "#101010" }]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#ffffff",
        "#000000",
      ),
    ).toContain("--color-bg: #000000");
  });

  it("reads and rewrites svg paint attributes that an inline style does not override", () => {
    const content = `<svg fill="none" viewBox="0 0 20 20"><path d="M0 0" fill="rgb(255, 255, 255)"></path><path d="M1 1" stroke="#000000" style="stroke: #a62e2e"></path></svg>`;
    const scopes = [{ fileId: "file-1", content, wholeDocument: true }];

    expect(selectionColorValues([], scopes).map((c) => c.value)).toEqual([
      "rgb(255, 255, 255)",
      "#a62e2e",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        scopes,
        "rgb(255, 255, 255)",
        "#ff0000",
      ),
    ).toContain('fill="#ff0000"');
  });

  it("orders results by descending frequency (most-used colors first)", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content: [
          '<div style="color:#111111;">',
          '<div style="color:#111111;">',
          '<div style="color:#111111;">',
          '<div style="color:#222222;">',
          '<div style="color:#222222;">',
          '<div style="color:#333333;">',
        ].join(""),
      },
    ]);

    expect(palette).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("skips fully transparent colors", () => {
    const palette = extractDocumentColorPalette([
      {
        id: "file-1",
        content:
          '<div style="color: rgba(0,0,0,0); background: #ABCDEF;"></div>',
      },
    ]);

    expect(palette).toEqual(["#ABCDEF"]);
  });

  it("caps results at the given limit, keeping the most frequent colors", () => {
    const content = Array.from({ length: 30 }, (_, i) => {
      const hex = i.toString(16).padStart(2, "0");
      // Repeat earlier colors more often than later ones so frequency order
      // is unambiguous once capped.
      const repeats = 30 - i;
      return `<div style="color:#${hex}${hex}${hex};">`.repeat(repeats);
    }).join("");

    const palette = extractDocumentColorPalette([{ id: "f", content }], 5);

    expect(palette).toHaveLength(5);
    // The 5 most-repeated colors are the first 5 generated (i = 0..4).
    expect(palette).toEqual([
      "#000000",
      "#010101",
      "#020202",
      "#030303",
      "#040404",
    ]);
  });

  it("returns an empty array for files with no colors", () => {
    expect(
      extractDocumentColorPalette([{ id: "f", content: "<div>hi</div>" }]),
    ).toEqual([]);
  });

  it("handles an empty files list", () => {
    expect(extractDocumentColorPalette([])).toEqual([]);
  });

  it("ignores unparseable color-shaped tokens without throwing", () => {
    expect(() =>
      extractDocumentColorPalette([
        { id: "f", content: '<div style="color: rgb(not, a, color)">' },
      ]),
    ).not.toThrow();
  });

  it("only scans color declarations, not attributes, text, URLs, or scripts", () => {
    const content =
      '<div id="color-#0066ff" data-value="#0066ff" style="color:#0066ff">#0066ff</div>' +
      '<script>const color = "#0066ff";</script>' +
      "<style>.card { background:#0066ff; background-image:url(#0066ff); }</style>";

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      '<div id="color-#0066ff" data-value="#0066ff" style="color:#ff0000">#0066ff</div>' +
        '<script>const color = "#0066ff";</script>' +
        "<style>.card { background:#ff0000; background-image:url(#0066ff); }</style>",
    );
  });

  it("skips CSS comments and handles greater-than signs in HTML attributes", () => {
    const content = `<div aria-label="A > B" style="color:#0066ff; /* don't scan #123456 */ background:#00ff00"></div>`;

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
      "#00FF00",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      `<div aria-label="A > B" style="color:#ff0000; /* don't scan #123456 */ background:#00ff00"></div>`,
    );
  });

  it("captures logical borders and text-decoration shorthand colors", () => {
    const content =
      '<div style="border-inline: 1px solid #0066ff; border-block-start-color:#00ff00; text-decoration: underline 2px #ff00aa"></div>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
      "#00FF00",
      "#FF00AA",
    ]);
  });

  it("anchors style-block replacement after the opening tag", () => {
    const content =
      '<style data-source="color:#0066ff>">.card { color:#0066ff }</style>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);

    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      '<style data-source="color:#0066ff>">.card { color:#ff0000 }</style>',
    );
  });

  it("does not parse style-like CSS strings as nested tags", () => {
    const content =
      '<style>.card::before { content: "<style>"; color:#0066ff }</style>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      '<style>.card::before { content: "<style>"; color:#ff0000 }</style>',
    );
  });

  it("does not mask script-like CSS strings before scanning styles", () => {
    const content =
      '<style>.card::before { content: "<script>"; color:#0066ff }</style>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      '<style>.card::before { content: "<script>"; color:#ff0000 }</style>',
    );
  });

  it("uses HTML quote rules for style attributes", () => {
    const content = '<style data-x="\\">.card { color:#0066ff }</style>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe('<style data-x="\\">.card { color:#ff0000 }</style>');
  });

  it("ignores style-like markup in non-rendered HTML", () => {
    const content =
      "<!-- <style>.comment { color:#111111 }</style> -->" +
      '<script>const template = "<style>.script { color:#222222 }</style>";</script>' +
      "<noscript><style>.noscript { color:#333333 }</style></noscript>" +
      "<style>.real { color:#0066ff }</style>";

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      "<!-- <style>.comment { color:#111111 }</style> -->" +
        '<script>const template = "<style>.script { color:#222222 }</style>";</script>' +
        "<noscript><style>.noscript { color:#333333 }</style></noscript>" +
        "<style>.real { color:#ff0000 }</style>",
    );
  });

  it("masks the remainder after an unclosed style block", () => {
    const content =
      '<style>.real { color:#0066ff }<div style="color:#00ff00"></div>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual(
      [],
    );
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#00ff00",
        "#ff0000",
      ),
    ).toBe(content);
  });

  it("does not accept whitespace in raw-text closing tags", () => {
    const content =
      '<style>.real { color:#0066ff }</ style><div style="color:#00ff00"></div>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual(
      [],
    );
  });

  it("requires actual raw-text tag-name boundaries", () => {
    const content =
      "<style-foo>.fake { color:#111111 }</style>" +
      "<style!>.malformed { color:#222222 }</style>" +
      '<div style="color:#0066ff"></div>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
  });

  it("accepts browser-recovered raw-text closing tags", () => {
    const content =
      '<style>.real { color:#0066ff }</style foo><div style="color:#00ff00"></div>' +
      '<style>.other { color:#ff00aa }</style/><div style="color:#ffffff"></div>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
      "#00FF00",
      "#FF00AA",
      "#FFFFFF",
    ]);
  });

  it("recovers malformed HTML comment termination", () => {
    const content =
      "<!-- hidden <style>.fake { color:#111111 }</style> --!>" +
      '<div style="color:#0066ff"></div>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      "<!-- hidden <style>.fake { color:#111111 }</style> --!>" +
        '<div style="color:#ff0000"></div>',
    );
  });

  it("does not treat quoted URL fragments as colors", () => {
    const content = `<div style='background-image: url("sprite)#0066ff.svg"); color:#0066ff'></div>`;

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      `<div style='background-image: url("sprite)#0066ff.svg"); color:#ff0000'></div>`,
    );
  });

  it("does not treat escaped URL function names as colors", () => {
    const content = String.raw`<div style='background-image: u\72 l(#0066ff); color:#0066ff'></div>`;

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      String.raw`<div style='background-image: u\72 l(#0066ff); color:#ff0000'></div>`,
    );
  });

  it("handles escaped newlines in URL function names", () => {
    const content = String.raw`<div style='background-image: u\
rl(#0066ff); color:#0066ff'></div>`;

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(String.raw`<div style='background-image: u\
rl(#0066ff); color:#ff0000'></div>`);
  });

  it("handles CRLF terminators after escaped hex digits", () => {
    const content =
      String.raw`<div style='background-image: u\72` +
      "\r\n" +
      String.raw`l(#0066ff); color:#0066ff'></div>`;

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      String.raw`<div style='background-image: u\72` +
        "\r\n" +
        String.raw`l(#0066ff); color:#ff0000'></div>`,
    );
  });

  it("does not treat escaped parentheses in URLs as colors", () => {
    const content = String.raw`<div style='background-image: url(sprite\)#0066ff.svg); color:#0066ff'></div>`;

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#0066FF",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
        "#ff0000",
      ),
    ).toBe(
      String.raw`<div style='background-image: url(sprite\)#0066ff.svg); color:#ff0000'></div>`,
    );
  });

  it("stops style scanning at raw-text closing tags", () => {
    const content =
      '<style>.card::before { content: "</style>"; color:#0066ff }</style>' +
      '<div style="color:#00ff00"></div>';

    expect(extractDocumentColorPalette([{ id: "file-1", content }])).toEqual([
      "#00FF00",
    ]);
    expect(
      replaceSelectionColorsInHtml(
        content,
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#00ff00",
        "#ff0000",
      ),
    ).toBe(
      '<style>.card::before { content: "</style>"; color:#0066ff }</style>' +
        '<div style="color:#ff0000"></div>',
    );
  });

  it("does not throw on invalid CSS escape code points", () => {
    const content = String.raw`<div style='background-image: u\ffffffl(#0066ff)'></div>`;

    expect(() =>
      extractDocumentColorPalette([{ id: "file-1", content }]),
    ).not.toThrow();
  });
});

describe("selectionColorValues", () => {
  it("skips the literal transparent spellings (existing behavior)", () => {
    const values = selectionColorValues(
      fakeElement({
        color: "rgb(0, 0, 0)",
        backgroundColor: "transparent",
        borderColor: "rgba(0, 0, 0, 0)",
        outlineColor: "",
      }),
    );

    expect(values).toEqual([{ property: "color", value: "rgb(0, 0, 0)" }]);
  });

  it("skips any other zero-alpha color, not just the two literal spellings", () => {
    // Regression: this used to only filter the exact strings "transparent"
    // and "rgba(0, 0, 0, 0)" — a zero-alpha color with any other RGB
    // channels or formatting (e.g. a non-black rgba, or hsla) slipped
    // through as a bogus, effectively-invisible "selection color" swatch.
    const values = selectionColorValues(
      fakeElement({
        color: "rgb(0, 0, 0)",
        backgroundColor: "rgba(255, 0, 0, 0)",
        borderColor: "hsla(210, 50%, 50%, 0)",
        outlineColor: "rgba(0,0,0,0)",
      }),
    );

    expect(values).toEqual([{ property: "color", value: "rgb(0, 0, 0)" }]);
  });

  it("keeps visible colors with non-zero alpha", () => {
    const values = selectionColorValues(
      fakeElement({
        color: "#111111",
        backgroundColor: "rgba(255, 0, 0, 0.5)",
        borderColor: "",
        outlineColor: "",
      }),
    );

    expect(values).toEqual([
      { property: "color", value: "#111111" },
      { property: "backgroundColor", value: "rgba(255, 0, 0, 0.5)" },
    ]);
  });

  it("dedupes equal colors across properties", () => {
    const values = selectionColorValues(
      fakeElement({
        color: "#111111",
        backgroundColor: "#111111",
        borderColor: "#111111",
        outlineColor: "",
      }),
    );

    expect(values).toEqual([{ property: "color", value: "#111111", count: 3 }]);
  });

  it("keeps unparseable non-color values through (e.g. a Mixed sentinel)", () => {
    const values = selectionColorValues(
      fakeElement({
        color: "Mixed",
        backgroundColor: "",
        borderColor: "",
        outlineColor: "",
      }),
    );

    expect(values).toEqual([{ property: "color", value: "Mixed" }]);
  });

  it("omits named computed colors without an authored token to replace", () => {
    expect(
      selectionColorValues(
        fakeElement({ color: "red", backgroundColor: "#ffffff" }),
      ),
    ).toEqual([{ property: "backgroundColor", value: "#ffffff" }]);
  });

  it("uses scoped source colors instead of unrelated computed colors", () => {
    const content =
      '<div data-agent-native-node-id="root" style="color:#0066ff"></div>';
    expect(
      selectionColorValues(fakeElement({ color: "#123456" }), [
        { fileId: "screen", content, sourceId: "root" },
      ]),
    ).toEqual([{ property: "color", value: "#0066ff" }]);
  });

  it("reads and replaces SVG presentation colors only inside the selected subtree", () => {
    const content = [
      '<svg data-agent-native-node-id="logo" aria-label="Brand fill=#f97316" data-note="stroke: #f97316" fill="#111111">',
      '<path fill="#f97316" d="M0 0h30v30z"/>',
      '<circle fill="#16a34a" cx="60" cy="20" r="15"/>',
      "</svg>",
      '<svg><path fill="#f97316" d="M0 0h10v10z"/></svg>',
    ].join("");
    const scopes = [{ fileId: "screen", content, sourceId: "logo" }];

    expect(selectionColorValues([], scopes)).toEqual([
      { property: "color", value: "#111111" },
      { property: "color", value: "#f97316" },
      { property: "color", value: "#16a34a" },
    ]);
    expect(
      replaceSelectionColorsInHtml(content, scopes, "#f97316", "#8b5cf6"),
    ).toBe(
      [
        '<svg data-agent-native-node-id="logo" aria-label="Brand fill=#f97316" data-note="stroke: #f97316" fill="#111111">',
        '<path fill="#8b5cf6" d="M0 0h30v30z"/>',
        '<circle fill="#16a34a" cx="60" cy="20" r="15"/>',
        "</svg>",
        '<svg><path fill="#f97316" d="M0 0h10v10z"/></svg>',
      ].join(""),
    );
  });

  it("preserves SVG ancestry while scanning nested selected groups and paths", () => {
    const content =
      '<svg data-an-primitive="pasted-svg"><g data-agent-native-node-id="group"><path data-agent-native-node-id="path" fill="#f97316"/></g></svg>';

    for (const sourceId of ["group", "path"]) {
      const scopes = [{ fileId: "screen", content, sourceId }];
      expect(selectionColorValues([], scopes)).toEqual([
        { property: "color", value: "#f97316" },
      ]);
      expect(
        replaceSelectionColorsInHtml(content, scopes, "#f97316", "#2563eb"),
      ).toBe(
        '<svg data-an-primitive="pasted-svg"><g data-agent-native-node-id="group"><path data-agent-native-node-id="path" fill="#2563eb"/></g></svg>',
      );
    }
  });

  it("does not treat SVG gradient references as colors but edits stop colors", () => {
    const content =
      '<svg data-agent-native-node-id="gradient"><defs><linearGradient id="a1b2c3"><stop stop-color="#123456"/></linearGradient></defs><path fill="url(#a1b2c3)" stroke="url(#fff)"/></svg>';
    const scopes = [{ fileId: "screen", content, sourceId: "gradient" }];

    expect(selectionColorValues([], scopes)).toEqual([
      { property: "color", value: "#123456" },
    ]);
    expect(
      replaceSelectionColorsInHtml(content, scopes, "#123456", "#ef4444"),
    ).toBe(
      '<svg data-agent-native-node-id="gradient"><defs><linearGradient id="a1b2c3"><stop stop-color="#ef4444"/></linearGradient></defs><path fill="url(#a1b2c3)" stroke="url(#fff)"/></svg>',
    );
  });

  it("scans every descendant in a selected source range and counts reuse", () => {
    const content = [
      '<section data-agent-native-node-id="root" style="color:#0066ff">',
      '<div style="background:#0066FF"></div>',
      '<div style="border-color:rgb(0, 102, 255)"></div>',
      '<div style="color:#ff0000"></div>',
      "</section>",
      '<aside style="color:#0066ff"></aside>',
    ].join("");

    expect(
      selectionColorValues(
        [],
        [{ fileId: "screen", content, sourceId: "root" }],
      ),
    ).toEqual([
      { property: "color", value: "#0066ff", count: 3 },
      { property: "color", value: "#ff0000" },
    ]);
  });

  it("finds matching authored paints on each source-scoped layer", () => {
    const content = `<body data-agent-native-layer-name="Frame" style="background:#101010">
      <div data-agent-native-node-id="matching" data-agent-native-layer-name="Matching" style="color:#101010"></div>
      <div data-agent-native-node-id="other" style="background:#ffffff"></div>
    </body>`;
    const projection = buildCodeLayerProjection(content);
    const expectedIds = projection.nodes
      .filter(
        (node) =>
          node.tag === "body" ||
          node.dataAttributes["data-agent-native-node-id"] === "matching",
      )
      .map((node) => node.id);

    expect(
      selectionColorTargets(
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#101010",
      ).map(({ nodeId }) => nodeId),
    ).toEqual(expectedIds);
  });

  it("does not claim a stylesheet-only color can locate an authored layer", () => {
    const content = `<!doctype html><html><head><style>.card { color: #0066ff; }</style></head><body><div class="card"></div></body></html>`;

    expect(
      selectionColorTargets(
        [{ fileId: "file-1", content, wholeDocument: true }],
        "#0066ff",
      ),
    ).toEqual([]);
  });

  it("resolves replacement ranges against the rewritten source snapshot", () => {
    const stale =
      '<section data-agent-native-node-id="root"><div style="color:#0066ff"></div></section>';
    const current =
      '<section data-agent-native-node-id="root" data-padding="a-much-longer-current-attribute"><div style="color:#0066ff"></div></section>';

    expect(
      replaceSelectionColorsInHtml(
        current,
        [{ fileId: "screen", content: stale, sourceId: "root" }],
        "#0066ff",
        "#ff0000",
      ),
    ).toContain('style="color:#ff0000"');
  });

  it("replaces a color throughout selected descendants but not outside them", () => {
    const content = [
      '<section data-agent-native-node-id="root" style="color:#0066ff">',
      '<div style="background:#0066FF"></div>',
      "</section>",
      '<aside style="color:#0066ff"></aside>',
    ].join("");
    const next = replaceSelectionColorsInHtml(
      content,
      [{ fileId: "screen", content, sourceId: "root" }],
      "#0066ff",
      "#ff0000",
    );

    expect(next).toBe(
      [
        '<section data-agent-native-node-id="root" style="color:#ff0000">',
        '<div style="background:#ff0000"></div>',
        "</section>",
        '<aside style="color:#0066ff"></aside>',
      ].join(""),
    );
  });

  it("aggregates and replaces the same color across multiple selected ranges", () => {
    const content = [
      '<div data-agent-native-node-id="first" style="color:#0066ff"></div>',
      '<div data-agent-native-node-id="outside" style="color:#0066ff"></div>',
      '<div data-agent-native-node-id="second" style="background:#0066ff"></div>',
    ].join("");
    const scopes = [
      { fileId: "screen", content, sourceId: "first" },
      { fileId: "screen", content, sourceId: "second" },
    ];

    expect(selectionColorValues([], scopes)).toEqual([
      { property: "color", value: "#0066ff", count: 2 },
    ]);
    expect(
      replaceSelectionColorsInHtml(content, scopes, "#0066ff", "#00aa00"),
    ).toBe(
      [
        '<div data-agent-native-node-id="first" style="color:#00aa00"></div>',
        '<div data-agent-native-node-id="outside" style="color:#0066ff"></div>',
        '<div data-agent-native-node-id="second" style="background:#00aa00"></div>',
      ].join(""),
    );
  });

  it("records the pre-preview source as the picker commit history baseline", () => {
    const before =
      '<div data-agent-native-node-id="root" style="color:#0066ff"></div>';
    const preview = before.replace("#0066ff", "#ff0000");
    const scopes = [{ fileId: "screen", content: before, sourceId: "root" }];
    const updates: Array<{
      content: string;
      options?: Record<string, unknown>;
    }> = [];
    const args = {
      activeFileId: "screen",
      applyFileContentUpdate: (
        _fileId: string,
        content: string,
        options?: Record<string, unknown>,
      ) => updates.push({ content, options }),
      canEditDesign: true,
      recordContentHistoryEntry: () => {},
      previewHistoryRef: {
        current: new Map<string, SelectionColorPreviewHistoryEntry>(),
      },
      pickerSessionRef: {
        current: new Map<string, SelectionColorPickerSessionEntry>(),
      },
      scopes,
    };

    runSelectionColorChange(args, "#0066ff", "#ff0000", {
      phase: "preview",
    });
    args.scopes = [{ fileId: "screen", content: preview, sourceId: "root" }];
    runSelectionColorChange(args, "#0066ff", "#ff0000", {
      phase: "commit",
    });

    expect(updates).toHaveLength(2);
    expect(updates[1]?.content).toBe(preview);
    expect(updates[1]?.options).toMatchObject({
      historyBeforeContent: before,
      persist: true,
      recordHistory: true,
    });
  });

  it("refuses an active preview after Undo replaces its source, then accepts a new gesture", () => {
    const initial =
      '<div data-agent-native-node-id="root" style="color:#f97316"></div>';
    const previousCommit = initial.replace("#f97316", "#3b82f6");
    const scopes = [{ fileId: "screen", content: initial, sourceId: "root" }];
    const updates: Array<{
      content: string;
      options?: Record<string, unknown>;
    }> = [];
    const args = {
      activeFileId: "screen",
      applyFileContentUpdate: (
        _fileId: string,
        content: string,
        options?: Record<string, unknown>,
      ) => updates.push({ content, options }),
      canEditDesign: true,
      recordContentHistoryEntry: () => {},
      previewHistoryRef: {
        current: new Map<string, SelectionColorPreviewHistoryEntry>(),
      },
      pickerSessionRef: {
        current: new Map<string, SelectionColorPickerSessionEntry>(),
      },
      scopes,
    };

    runSelectionColorChange(args, "#f97316", "#3b82f6");
    args.scopes = [
      { fileId: "screen", content: previousCommit, sourceId: "root" },
    ];
    runSelectionColorChange(args, "#3b82f6", "#22c55e", {
      phase: "preview",
    });

    // Undo restores the source from before the prior commit while the picker
    // remains open; the old gesture must not target a color in that new source.
    args.scopes = [{ fileId: "screen", content: initial, sourceId: "root" }];
    expect(
      runSelectionColorChange(args, "#f97316", "#22c55e", {
        phase: "commit",
      }),
    ).toEqual({ status: "refused" });

    expect(updates).toHaveLength(2);
    expect(args.previewHistoryRef.current.has("screen")).toBe(false);
    setSelectionColorPickerSession(args, "#f97316", false);
    setSelectionColorPickerSession(args, "#f97316", true);

    expect(
      runSelectionColorChange(args, "#f97316", "#22c55e", {
        phase: "preview",
      }),
    ).toEqual({ status: "applied" });
    const freshPreview = updates[updates.length - 1]?.content;
    expect(freshPreview).toBeDefined();
    args.scopes = [
      { fileId: "screen", content: freshPreview!, sourceId: "root" },
    ];
    expect(
      runSelectionColorChange(args, "#f97316", "#22c55e", {
        phase: "commit",
      }),
    ).toEqual({ status: "applied" });
    expect(updates[updates.length - 1]?.content).toContain("#22c55e");
    expect(updates[updates.length - 1]?.options).toMatchObject({
      historyBeforeContent: initial,
      persist: true,
      recordHistory: true,
    });
  });

  it("keeps replacing the original swatch after a preview collides with another color", () => {
    const before = `<!doctype html><html><body><div data-agent-native-node-id="group"><div data-agent-native-node-id="opaque" style="background:#2f74f5"></div><div data-agent-native-node-id="translucent" style="background:rgba(47,116,245,0.5)"></div></div></body></html>`;
    const scope = { fileId: "screen", content: before, sourceId: "group" };
    const updates: Array<{
      content: string;
      options?: Record<string, unknown>;
    }> = [];
    const args = {
      activeFileId: "screen",
      applyFileContentUpdate: (
        _fileId: string,
        content: string,
        options?: Record<string, unknown>,
      ) => updates.push({ content, options }),
      canEditDesign: true,
      recordContentHistoryEntry: () => {},
      previewHistoryRef: {
        current: new Map<string, SelectionColorPreviewHistoryEntry>(),
      },
      pickerSessionRef: {
        current: new Map<string, SelectionColorPickerSessionEntry>(),
      },
      scopes: [scope],
    };
    const atEighty = before.replace(
      "rgba(47,116,245,0.5)",
      "rgba(47,116,245,0.8)",
    );
    args.scopes = [{ ...scope, content: before }];
    runSelectionColorChange(
      args,
      "rgba(47,116,245,0.5)",
      "rgba(47,116,245,0.8)",
      {
        phase: "preview",
      },
    );

    const atOneHundred = before.replace("rgba(47,116,245,0.5)", "#2f74f5");
    args.scopes = [{ ...scope, content: atEighty }];
    runSelectionColorChange(args, "rgba(47,116,245,0.5)", "#2f74f5", {
      phase: "preview",
    });

    args.scopes = [{ ...scope, content: atOneHundred }];
    expect(
      runSelectionColorChange(args, "rgba(47,116,245,0.5)", "#2f74f5", {
        phase: "commit",
      }),
    ).toEqual({ status: "applied" });
    expect(updates[updates.length - 1]?.content).toBe(atOneHundred);
    expect(updates[updates.length - 1]?.options).toMatchObject({
      historyBeforeContent: before,
      persist: true,
      recordHistory: true,
    });

    const backToEighty = before.replace(
      "rgba(47,116,245,0.5)",
      "rgba(47,116,245,0.8)",
    );
    args.scopes = [{ ...scope, content: atOneHundred }];
    expect(
      runSelectionColorChange(
        args,
        "rgba(47,116,245,0.5)",
        "rgba(47,116,245,0.8)",
        { phase: "preview" },
      ),
    ).toEqual({ status: "applied" });
    expect(updates[updates.length - 1]?.content).toBe(backToEighty);
    expect(updates[updates.length - 1]?.content).toContain(
      'data-agent-native-node-id="opaque" style="background:#2f74f5"',
    );

    args.scopes = [{ ...scope, content: backToEighty }];
    expect(
      runSelectionColorChange(
        args,
        "rgba(47,116,245,0.5)",
        "rgba(47,116,245,0.8)",
        {
          phase: "commit",
        },
      ),
    ).toEqual({ status: "applied" });
    expect(updates[updates.length - 1]?.content).toBe(backToEighty);
    expect(updates[updates.length - 1]?.options).toMatchObject({
      historyBeforeContent: atOneHundred,
      persist: true,
      recordHistory: true,
    });
  });

  it("records one composite history entry for a multi-file picker commit", () => {
    const beforeFirst =
      '<!doctype html><html><body style="background-color:#2f74f5">A</body></html>';
    const beforeSecond =
      '<!doctype html><html><body style="background-color:#2f74f5">B</body></html>';
    const scopes = [
      { fileId: "first", content: beforeFirst, wholeDocument: true },
      { fileId: "second", content: beforeSecond, wholeDocument: true },
    ];
    const updates: Array<{
      fileId: string;
      content: string;
      options?: Record<string, unknown>;
    }> = [];
    const historyEntries: unknown[] = [];
    const args = {
      activeFileId: null,
      applyFileContentUpdate: (
        fileId: string,
        content: string,
        options?: Record<string, unknown>,
      ) => updates.push({ fileId, content, options }),
      canEditDesign: true,
      recordContentHistoryEntry: (entry: unknown) => historyEntries.push(entry),
      previewHistoryRef: {
        current: new Map<string, SelectionColorPreviewHistoryEntry>(),
      },
      pickerSessionRef: {
        current: new Map<string, SelectionColorPickerSessionEntry>(),
      },
      scopes,
    };
    setSelectionColorPickerSession(args, "#2f74f5", true);

    expect(
      runSelectionColorChange(args, "#2f74f5", "#ec4899", {
        phase: "preview",
      }),
    ).toEqual({ status: "applied" });
    const afterFirst = beforeFirst.replace("#2f74f5", "#ec4899");
    const afterSecond = beforeSecond.replace("#2f74f5", "#ec4899");
    args.scopes = [
      { fileId: "first", content: afterFirst, wholeDocument: true },
      { fileId: "second", content: afterSecond, wholeDocument: true },
    ];
    expect(
      runSelectionColorChange(args, "#2f74f5", "#ec4899", {
        phase: "commit",
      }),
    ).toEqual({ status: "applied" });

    expect(updates).toHaveLength(4);
    expect(updates.slice(2).map(({ options }) => options)).toEqual([
      {
        forcePreviewFullDocument: false,
        persist: true,
        recordHistory: false,
        historyBeforeContent: beforeFirst,
      },
      {
        forcePreviewFullDocument: false,
        persist: true,
        recordHistory: false,
        historyBeforeContent: beforeSecond,
      },
    ]);
    expect(historyEntries).toEqual([
      {
        changes: [
          { fileId: "first", before: beforeFirst, after: afterFirst },
          { fileId: "second", before: beforeSecond, after: afterSecond },
        ],
      },
    ]);
  });

  it("keeps a stale preview invalid through later ticks until its terminal commit", () => {
    const before =
      '<div data-agent-native-node-id="root" style="color:#f97316"></div>';
    const preview = before.replace("#f97316", "#3b82f6");
    const externallyChanged = before.replace("#f97316", "#22c55e");
    const updates: string[] = [];
    const args = {
      activeFileId: "screen",
      applyFileContentUpdate: (_fileId: string, content: string) => {
        updates.push(content);
      },
      canEditDesign: true,
      recordContentHistoryEntry: () => {},
      previewHistoryRef: {
        current: new Map<string, SelectionColorPreviewHistoryEntry>(),
      },
      pickerSessionRef: {
        current: new Map<string, SelectionColorPickerSessionEntry>(),
      },
      scopes: [{ fileId: "screen", content: before, sourceId: "root" }],
    };

    runSelectionColorChange(args, "#f97316", "#3b82f6", {
      phase: "preview",
    });
    args.scopes = [{ fileId: "screen", content: preview, sourceId: "root" }];
    runSelectionColorChange(args, "#f97316", "#3b82f6", {
      phase: "preview",
    });
    args.scopes = [
      { fileId: "screen", content: externallyChanged, sourceId: "root" },
    ];
    expect(
      runSelectionColorChange(args, "#3b82f6", "#0f766e", {
        phase: "preview",
      }),
    ).toEqual({ status: "refused" });
    expect(args.previewHistoryRef.current.get("screen")?.invalidated).toBe(
      true,
    );
    expect(
      runSelectionColorChange(args, "#3b82f6", "#ef4444", {
        phase: "preview",
      }),
    ).toEqual({ status: "refused" });
    expect(
      runSelectionColorChange(args, "#3b82f6", "#ef4444", {
        phase: "commit",
      }),
    ).toEqual({ status: "refused" });
    expect(args.previewHistoryRef.current.has("screen")).toBe(false);
    expect(updates).toEqual([preview]);
  });
});

describe("selectionFillColorValues", () => {
  it("exposes one shared fill/text color while excluding strokes and borders", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group">
        <div style="background-color:#f97316;border:8px solid #f97316"></div>
        <div style="background:#f97316;border-color:#111827"></div>
        <p style="color:#f97316;text-shadow:0 0 2px #f97316">Paint</p>
      </div>
    </body></html>`;
    const scopes = [
      {
        fileId: "file",
        content,
        sourceId: "group",
      },
    ];

    expect(selectionFillColorValues(scopes)).toEqual([
      { property: "fill", value: "#f97316", count: 3 },
    ]);

    const replaced = replaceSelectionFillColorsInHtml(
      content,
      scopes,
      "#f97316",
      "#3b82f6",
    );
    expect(replaced).toContain("background-color:#3b82f6");
    expect(replaced).toContain("background:#3b82f6");
    expect(replaced).toContain("color:#3b82f6");
    expect(replaced).toContain("border:8px solid #f97316");
    expect(replaced).toContain("text-shadow:0 0 2px #f97316");
  });

  it("does not count an unfilled text box as a separate empty Group Fill", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-agent-native-node-id="shape-a" data-an-primitive="rectangle" style="position:absolute;width:120px;height:80px;background:#f97316"></div>
        <div data-agent-native-node-id="shape-b" data-an-primitive="rectangle" style="position:absolute;width:120px;height:80px;background:#f97316"></div>
        <div data-agent-native-node-id="text" style="position:absolute;left:20px;top:100px;width:220px;height:48px;color:#f97316">Paint</div>
      </div>
    </body></html>`;
    const model = selectionFillModel([
      { fileId: "file", content, sourceId: "group" },
    ]);

    expect(model.state).toBe("common");
    expect(model.targets.map(({ channel }) => channel)).toEqual([
      "background",
      "background",
      "text",
    ]);
    expect(
      model.stacks.map((stack) =>
        stack.map(({ kind, value, opacity }) => [kind, value, opacity]),
      ),
    ).toEqual([
      [["solid", "#f97316", 100]],
      [["solid", "#f97316", 100]],
      [["solid", "#f97316", 100]],
    ]);
  });

  it("keeps mixed descendant fills in Selection Colors instead of stacking Group Fill rows", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group">
        <div style="background-color:#f97316"></div>
        <div style="background-color:#3b82f6"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];

    expect(selectionFillColorValues(scopes)).toEqual([]);
    expect(selectionColorValues([], scopes).map(({ value }) => value)).toEqual([
      "#f97316",
      "#3b82f6",
    ]);
  });

  it("uses a unique selector to disambiguate duplicate Group ids for paint reads and writes", () => {
    const content = `<!doctype html><html><body>
      <div class="first" data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-agent-native-node-id="shape-a" style="background:#f97316"></div>
      </div>
      <div class="second" data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-agent-native-node-id="shape-b" style="background:#f97316"></div>
      </div>
    </body></html>`;
    const groups = buildCodeLayerProjection(content).nodes.filter(
      (node) => node.dataAttributes["data-agent-native-group"] === "true",
    );
    expect(groups).toHaveLength(2);
    const secondGroup = groups[1];
    expect(secondGroup).toBeDefined();
    const scope = {
      fileId: "file",
      content,
      sourceId: "group",
      selector: ".second",
    };

    const model = selectionFillModel([scope]);
    expect(
      model.targets.map(({ selector, channel }) => ({ selector, channel })),
    ).toEqual([
      {
        selector: '[data-agent-native-node-id="shape-b"]',
        channel: "background",
      },
    ]);
    const result = rewriteSelectionFillStyles([scope], {
      backgroundColor: "#3b82f6",
      backgroundImage: "none",
    });
    expect(result.status, result.message).toBe("applied");
    const rewritten = result.updates[0]?.content ?? "";
    expect(rewritten).toMatch(/shape-a[^>]*background:\s*#f97316/);
    expect(rewritten).toMatch(/shape-b[^>]*background-color:\s*#3b82f6/);
  });

  it("refuses multi-Group paint edits when any duplicate-id scope is ambiguous", () => {
    const content = `<!doctype html><html><body>
      <div class="first" data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-agent-native-node-id="shape-a" style="background:#f97316"></div>
      </div>
      <div class="second" data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-agent-native-node-id="shape-b" style="background:#f97316"></div>
      </div>
    </body></html>`;
    const validScope = {
      fileId: "file",
      content,
      sourceId: "group",
      selector: ".first",
    };
    const ambiguousScope = { fileId: "file", content, sourceId: "group" };
    const scopes = [validScope, ambiguousScope];

    expect(selectionFillModel([ambiguousScope])).toMatchObject({
      scopeConflict: true,
      targets: [],
    });
    const rewrite = rewriteSelectionFillStyles(scopes, {
      backgroundColor: "#3b82f6",
      backgroundImage: "none",
    });
    expect(rewrite.status).toBe("conflict");
    expect(rewrite.updates).toEqual([]);
    expect(
      replaceSelectionColorsInHtml(content, scopes, "#f97316", "#3b82f6"),
    ).toBeNull();
  });

  it("refuses multi-file Selection Colors atomically when one scope is ambiguous", () => {
    const validContent =
      '<div data-agent-native-node-id="valid" style="color:#f97316"></div>';
    const ambiguousContent = `<!doctype html><html><body>
      <div data-agent-native-node-id="duplicate" style="color:#f97316"></div>
      <div data-agent-native-node-id="duplicate" style="color:#f97316"></div>
    </body></html>`;
    const updates: string[] = [];
    const previewHistoryRef = {
      current: new Map([
        ["ambiguous-file", { before: "before", after: "current" }],
      ]),
    };
    const pickerSessionRef = {
      current: new Map<string, SelectionColorPickerSessionEntry>(),
    };
    const args = {
      activeFileId: "valid-file",
      applyFileContentUpdate: (_fileId: string, content: string) => {
        updates.push(content);
      },
      canEditDesign: true,
      recordContentHistoryEntry: () => {},
      previewHistoryRef,
      pickerSessionRef,
      scopes: [
        { fileId: "valid-file", content: validContent, sourceId: "valid" },
        {
          fileId: "ambiguous-file",
          content: ambiguousContent,
          sourceId: "duplicate",
        },
      ],
    };

    expect(
      runSelectionColorChange(args, "#f97316", "#3b82f6", {
        phase: "preview",
      }),
    ).toEqual({ status: "refused" });
    expect(
      runSelectionColorChange(args, "#f97316", "#3b82f6", {
        phase: "commit",
      }),
    ).toEqual({ status: "refused" });
    expect(updates).toEqual([]);
    expect(Array.from(previewHistoryRef.current)).toEqual([
      ["ambiguous-file", { before: "before", after: "current" }],
    ]);
  });

  it("does not misreport a same-color gradient with varied stop alpha as a solid Group Fill", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group">
        <div style="background-image:linear-gradient(90deg,#3b82f6 0%,color-mix(in srgb,#3b82f6 25%,transparent) 100%)"></div>
        <div style="background-image:linear-gradient(90deg,#3b82f6 0%,color-mix(in srgb,#3b82f6 25%,transparent) 100%)"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];

    expect(selectionFillColorValues(scopes)).toEqual([]);
    expect(selectionFillModel(scopes).state).toBe("common");
    expect(selectionFillModel(scopes).stacks[0]?.[0]?.kind).toBe("gradient");
  });

  it("treats gradients with different stop alpha as different ordered paints", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div style="background-image:linear-gradient(90deg,#3b82f6 0%,color-mix(in srgb,#3b82f6 25%,transparent) 100%)"></div>
        <div style="background-image:linear-gradient(90deg,#3b82f6 0%,color-mix(in srgb,#3b82f6 50%,transparent) 100%)"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];

    expect(selectionFillModel(scopes).state).toBe("mixed");
    expect(selectionFillColorValues(scopes)).toEqual([]);
  });

  it("includes an empty geometric fill stack when deciding whether Group Fill is common", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-an-primitive="rectangle" style="position:absolute;width:40px;height:40px"></div>
        <div data-an-primitive="rectangle" style="position:absolute;width:40px;height:40px;background-color:#3b82f6"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];

    const model = selectionFillModel(scopes);
    expect(
      model,
      JSON.stringify(
        model.targets.map(({ nodeId, channel, stack }) => ({
          nodeId,
          channel,
          stack,
        })),
      ),
    ).toMatchObject({
      state: "mixed",
      stacks: [[], [{ kind: "solid", value: "#3b82f6" }]],
    });
    expect(selectionFillColorValues(scopes)).toEqual([]);
  });

  it("keeps paint stack order when comparing group descendants", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div style="background-color:#3b82f6;background-image:linear-gradient(90deg,#f97316,#111827),linear-gradient(90deg,#ffffff,#000000)"></div>
        <div style="background-color:#3b82f6;background-image:linear-gradient(90deg,#ffffff,#000000),linear-gradient(90deg,#f97316,#111827)"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];

    expect(selectionFillModel(scopes).state).toBe("mixed");
    expect(selectionFillColorValues(scopes)).toEqual([]);
  });

  it("treats a Boolean result as one visible vector fill, not its mask operands", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <svg data-agent-native-node-id="subtract" data-an-primitive="boolean" style="--boolean-mask-fill:#f97316;--boolean-mask-stroke:#111827">
          <defs><mask><use style="fill:white"></use><svg data-an-primitive="boolean-operand" style="--operand-fill:#111827"><rect style="fill:#111827"></rect></svg></mask></defs>
          <use data-an-boolean-result="true" style="fill:var(--boolean-mask-fill)"></use>
        </svg>
        <div style="background-color:#f97316"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const model = selectionFillModel(scopes);

    expect(model.state).toBe("common");
    expect(model.targets.map(({ channel }) => channel)).toEqual([
      "vector",
      "background",
    ]);
    expect(model.targets[0]?.stack).toMatchObject([
      { kind: "solid", value: "#f97316" },
    ]);
  });

  it("keeps authored alpha zero distinct from eye-hidden fill state", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div style="background-color:rgba(249,115,22,0)"></div>
        <div style="background-color:color-mix(in srgb,#f97316 0%,transparent)"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];

    expect(selectionFillModel(scopes).state).toBe("mixed");
    expect(selectionFillModel(scopes).stacks).toMatchObject([
      [{ opacity: 0 }],
      [{ hidden: true, opacity: 0 }],
    ]);
  });

  it("keeps Boolean results opaque to Group Fill while excluding SVG mask scaffolding", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <svg data-agent-native-node-id="subtract" data-an-primitive="boolean" style="--boolean-mask-fill:#f97316;--boolean-mask-stroke:#111827">
          <defs><mask><use style="fill:white"></use><svg data-an-primitive="boolean-operand" style="--operand-fill:#111827"><rect style="fill:#111827"></rect></svg></mask></defs>
          <use data-an-boolean-result="true" style="fill:var(--boolean-mask-fill)"></use>
        </svg>
        <div style="background-color:#f97316"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const model = selectionFillModel(scopes);

    expect(model.state).toBe("common");
    expect(model.targets.map(({ channel }) => channel)).toEqual([
      "vector",
      "background",
    ]);
    expect(model.targets).toHaveLength(2);
    expect(
      model.targets.flatMap(({ stack }) => stack).map(({ value }) => value),
    ).toEqual(["#f97316", "#f97316"]);
  });

  it("models one ordinary SVG shape as a vector fill and edits that shape", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-an-primitive="rectangle" style="background-color:#f97316"></div>
        <svg data-agent-native-node-id="icon" style="width:24px;height:24px"><circle cx="12" cy="12" r="8" fill="#f97316" stroke="#111827" stroke-width="2"/></svg>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const model = selectionFillModel(scopes);

    expect(model.state).toBe("common");
    expect(model.targets.map(({ channel }) => channel)).toEqual([
      "background",
      "vector",
    ]);

    const result = rewriteSelectionFillStyles(scopes, {
      backgroundColor: "#3b82f6",
      backgroundImage: "none",
    });
    expect(result.status, result.message).toBe("applied");
    const rewritten = result.updates[0]?.content ?? "";
    expect(rewritten).toMatch(
      /<circle[^>]*fill="#f97316"[^>]*style="[^"]*fill: #3b82f6/,
    );
    expect(rewritten).toContain('stroke="#111827"');
    expect(rewritten).not.toMatch(/<svg[^>]*style="[^"]*fill: #3b82f6/);
  });

  it("refuses multi-shape inline SVG fills instead of painting their bounds", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-an-primitive="rectangle" style="background-color:#f97316"></div>
        <svg data-agent-native-node-id="icon" style="width:24px;height:24px"><circle cx="12" cy="12" r="8" fill="#f97316"/><path d="M0 0h4" stroke="#111827"/></svg>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const model = selectionFillModel(scopes);
    const result = rewriteSelectionFillStyles(scopes, {
      backgroundColor: "#3b82f6",
      backgroundImage: "none",
    });

    expect(model.state).toBe("mixed");
    expect(result.status).toBe("unsupported");
    expect(result.updates).toEqual([]);
  });

  it("fills nested rich text through its text owner without flattening the runs", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-an-primitive="rectangle" style="background-color:#f97316"></div>
        <p data-agent-native-node-id="text" style="color:#f97316">Paint <strong style="color:#c026d3">this</strong></p>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const model = selectionFillModel(scopes);

    expect(model.state).toBe("common");
    expect(model.targets.map(({ channel }) => channel)).toEqual([
      "background",
      "text",
    ]);
    const result = rewriteSelectionFillStyles(scopes, {
      backgroundColor: "#3b82f6",
      backgroundImage: "none",
    });

    expect(result.status, result.message).toBe("applied");
    const rewritten = result.updates[0]?.content ?? "";
    expect(rewritten).toContain('<strong style="color:#c026d3">this</strong>');
    expect(rewritten).toContain("background-clip: text");
    expect(rewritten).toContain("-webkit-text-fill-color: transparent");
    expect(rewritten).not.toContain("<strong data-an-text>");
  });

  it("keeps generated text hosts unpainted through repeated Group Fill edits", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-an-primitive="rectangle" style="background-color:#f97316"></div>
        <div data-agent-native-node-id="text" data-agent-native-layer-name="Fill Text" style="position:absolute;left:20px;top:100px;width:220px;height:48px;color:#f97316;font-size:24px;line-height:48px">Paint</div>
      </div>
    </body></html>`;
    const scope = { fileId: "file", content, sourceId: "group" };
    const findLayer = (
      layers: CodeLayerTreeNode[],
      id: string,
    ): CodeLayerTreeNode | undefined => {
      for (const layer of layers) {
        if (layer.id === id) return layer;
        const nested = findLayer(layer.children, id);
        if (nested) return nested;
      }
      return undefined;
    };
    const originalTextNode = buildCodeLayerProjection(content).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "text",
    );
    expect(originalTextNode).toBeDefined();
    const originalTextLayer = findLayer(
      buildCodeLayerTree(buildCodeLayerProjection(content)),
      originalTextNode!.id,
    );
    expect(originalTextLayer).toMatchObject({
      name: "Fill Text",
      type: "text",
      children: [],
    });

    const first = rewriteSelectionFillStyles([scope], {
      backgroundColor: "#3b82f6",
      backgroundImage: "none",
    });
    expect(first.status, first.message).toBe("applied");
    const firstContent = first.updates[0]?.content ?? "";
    const inspectText = (html: string) => {
      const nodes = buildCodeLayerProjection(html).nodes;
      const textNode = nodes.find(
        (node) => node.dataAttributes["data-agent-native-node-id"] === "text",
      );
      return {
        host: textNode,
        glyph: nodes.find(
          (node) => node.attributes["data-an-text"] !== undefined,
        ),
        textNodeId: textNode?.id,
      };
    };
    const firstText = inspectText(firstContent);
    expect(firstText.glyph).toBeUndefined();
    expect(firstText.host?.style).toMatchObject({
      "background-color": "#3b82f6",
      "background-clip": "text",
      "-webkit-background-clip": "text",
      color: "transparent",
      "-webkit-text-fill-color": "transparent",
    });

    const second = rewriteSelectionFillStyles(
      [{ ...scope, content: firstContent }],
      {
        backgroundColor: "rgba(59, 130, 246, 0.5)",
        backgroundImage: "none",
      },
    );
    expect(second.status, second.message).toBe("applied");
    const secondContent = second.updates[0]?.content ?? "";
    const secondText = inspectText(secondContent);
    expect(secondText.glyph).toBeUndefined();
    expect(secondText.host?.style["background-color"]).toBe(
      "rgba(59, 130, 246, 0.5)",
    );
    expect(secondText.host?.style["background-clip"]).toBe("text");

    const third = rewriteSelectionFillStyles(
      [{ ...scope, content: secondContent }],
      { backgroundColor: "#22c55e", backgroundImage: "none" },
    );
    expect(third.status, third.message).toBe("applied");
    const thirdText = inspectText(third.updates[0]?.content ?? "");
    expect(thirdText.glyph).toBeUndefined();
    expect(thirdText.host?.style["background-color"]).toBe("#22c55e");
    expect(thirdText.host?.style["background-clip"]).toBe("text");
    const thirdProjection = buildCodeLayerProjection(
      third.updates[0]?.content ?? "",
    );
    const thirdTextNode = thirdProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "text",
    );
    expect(
      findLayer(
        buildCodeLayerTree(thirdProjection),
        thirdTextNode?.id ?? "missing-text",
      ),
    ).toMatchObject({
      name: "Fill Text",
      type: "frame",
      children: [],
    });
  });

  it("preserves an authored text-container background while recoloring text", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-an-primitive="rectangle" style="background-color:#f97316"></div>
        <div data-agent-native-node-id="text" style="position:absolute;left:20px;top:100px;width:220px;height:48px;color:#f97316;background-color:#111827">Paint</div>
      </div>
    </body></html>`;
    const result = rewriteSelectionFillStyles(
      [{ fileId: "file", content, sourceId: "group" }],
      { backgroundColor: "#3b82f6", backgroundImage: "none" },
    );

    expect(result.status, result.message).toBe("applied");
    const nodes = buildCodeLayerProjection(
      result.updates[0]?.content ?? "",
    ).nodes;
    const host = nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "text",
    );
    const glyph = nodes.find(
      (node) => node.attributes["data-an-text"] !== undefined,
    );
    expect(host?.style["background-color"]).toBe("#111827");
    expect(glyph?.style).toMatchObject({
      "background-color": "#3b82f6",
      "background-clip": "text",
      "-webkit-text-fill-color": "transparent",
    });
  });

  it("recolors existing text wrappers without painting their class-backed host", () => {
    const content = `<!doctype html><html><head><style>.text-host{background-color:#111827}</style></head><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-an-primitive="rectangle" style="background-color:#f97316"></div>
        <div data-agent-native-node-id="text" class="text-host" style="position:absolute;left:20px;top:100px;width:220px;height:48px;color:#f97316"><span data-an-text>Paint</span></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const model = selectionFillModel(scopes);
    expect(model.state).toBe("common");
    expect(model.targets.map(({ channel }) => channel)).toEqual([
      "background",
      "text",
    ]);

    const result = rewriteSelectionFillStyles(scopes, {
      backgroundColor: "#3b82f6",
      backgroundImage: "none",
    });
    expect(result.status, result.message).toBe("applied");
    const rewritten = result.updates[0]?.content ?? "";
    const nodes = buildCodeLayerProjection(rewritten).nodes;
    const host = nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "text",
    );
    const glyph = nodes.find(
      (node) => node.attributes["data-an-text"] !== undefined,
    );
    expect(host?.classes).toContain("text-host");
    expect(host?.style["background-color"]).toBeUndefined();
    expect(glyph?.style).toMatchObject({
      "background-color": "#3b82f6",
      "background-clip": "text",
      "-webkit-text-fill-color": "transparent",
    });
    expect(rewritten).toContain(".text-host{background-color:#111827}");
  });

  it("refuses rich text with an explicit nested text-fill override atomically", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-an-primitive="rectangle" style="background-color:#f97316"></div>
        <p style="color:#f97316">Paint <strong style="-webkit-text-fill-color:#c026d3">this</strong></p>
      </div>
    </body></html>`;
    const result = rewriteSelectionFillStyles(
      [{ fileId: "file", content, sourceId: "group" }],
      { backgroundColor: "#3b82f6", backgroundImage: "none" },
    );

    expect(result.status).toBe("unsupported");
    expect(result.updates).toEqual([]);
  });

  it("adds a shared black 20% paint above the existing group fill stack", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-agent-native-node-id="shape-a" data-an-primitive="rectangle" style="background:#f97316;border:8px solid #111827"></div>
        <div data-agent-native-node-id="shape-b" data-an-primitive="rectangle" style="background:#f97316;border:8px solid #f97316"></div>
        <p data-agent-native-node-id="text" style="color:#f97316">Paint</p>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const added = selectionFillAddedStyles(selectionFillModel(scopes));

    expect(added.open).toBe("layer");
    expect(added.styles.backgroundColor).toBe("#f97316");
    expect(added.styles.backgroundImage).toContain("rgba(0, 0, 0, 0.2)");

    const result = rewriteSelectionFillStyles(scopes, added.styles);
    expect(result.status, result.message).toBe("applied");
    const rewritten = result.updates[0]?.content ?? "";
    expect(rewritten).toMatch(/border:\s*8px solid #111827/);
    expect(rewritten).toMatch(/border:\s*8px solid #f97316/);
    expect(
      rewritten.match(/background-image:[^;]*rgba\(0, 0, 0, 0\.2\)/g),
    ).toHaveLength(3);
    expect(rewritten).not.toContain("data-an-text");
    expect(rewritten).toMatch(/background-clip:\s*text/);
    expect(rewritten).toMatch(/-webkit-text-fill-color:\s*transparent/);
  });

  it("replaces mixed fills with the most recently committed color", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-agent-native-node-id="shape-a" data-an-primitive="rectangle" style="background-color:#f97316"></div>
        <div data-agent-native-node-id="shape-b" data-an-primitive="rectangle" style="background-color:#3b82f6"></div>
        <p data-agent-native-node-id="text" style="color:#f97316">Paint</p>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const added = selectionFillAddedStyles(
      selectionFillModel(scopes),
      "#3b82f6",
    );

    expect(added.open).toBe("base");
    expect(added.styles.backgroundColor).toMatch(/(?:#3b82f6|59, 130, 246)/i);
    expect(added.styles.backgroundImage).toBe("none");

    const result = rewriteSelectionFillStyles(scopes, added.styles);
    expect(result.status).toBe("applied");
    const rewritten = result.updates[0]?.content ?? "";
    expect(
      rewritten.match(/background-color:\s*(?:#3b82f6|rgb\(59, 130, 246\))/g),
    ).toHaveLength(3);
    expect(rewritten).toMatch(/-webkit-text-fill-color:\s*transparent/);
    expect(rewritten).not.toContain("background-color:#f97316");
  });

  it("keeps visibility metadata separate from authored zero-alpha paint", () => {
    const transparentContent = `<div data-agent-native-node-id="shape" data-an-primitive="rectangle" style="background-color:rgba(249,115,22,0)"></div>`;
    const hiddenContent = `<div data-agent-native-node-id="shape" data-an-primitive="rectangle" style="background-color:color-mix(in srgb,#f97316 0%,transparent)"></div>`;
    const transparent = selectionFillInspectorStyles(
      selectionFillModel([
        {
          fileId: "transparent",
          content: transparentContent,
          wholeDocument: true,
        },
      ]),
    );
    const hidden = selectionFillInspectorStyles(
      selectionFillModel([
        { fileId: "hidden", content: hiddenContent, wholeDocument: true },
      ]),
    );

    expect(transparent.backgroundColor).toBe("rgba(249, 115, 22, 0)");
    expect(hidden.backgroundColor).toBe(
      "color-mix(in srgb, #f97316 0%, transparent)",
    );
  });

  it("refuses the whole Group edit when SVG use cannot be represented", () => {
    const useContent = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <div data-agent-native-node-id="shape" data-an-primitive="rectangle" style="background:#f97316"></div>
        <svg data-agent-native-node-id="icon" style="width:24px;height:24px"><use href="#shape"></use></svg>
      </div>
    </body></html>`;
    const styles = { backgroundColor: "#3b82f6", backgroundImage: "none" };
    const unsupportedUse = rewriteSelectionFillStyles(
      [{ fileId: "use", content: useContent, sourceId: "group" }],
      styles,
    );
    expect(
      unsupportedUse.status,
      JSON.stringify(
        selectionFillModel([
          { fileId: "use", content: useContent, sourceId: "group" },
        ]),
      ),
    ).toBe("unsupported");
    expect(unsupportedUse.updates).toEqual([]);
  });

  it("does not partially apply a stacked Group fill when a Boolean result cannot accept layers", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="group" data-agent-native-group="true">
        <svg data-agent-native-node-id="subtract" data-an-primitive="boolean" style="--boolean-mask-fill:#f97316;fill:var(--boolean-mask-fill)"><defs><mask></mask></defs></svg>
        <div data-agent-native-node-id="shape" data-an-primitive="rectangle" style="background:#f97316"></div>
      </div>
    </body></html>`;
    const scopes = [{ fileId: "file", content, sourceId: "group" }];
    const added = selectionFillAddedStyles(selectionFillModel(scopes));
    const result = rewriteSelectionFillStyles(scopes, added.styles);

    expect(result.status).toBe("unsupported");
    expect(result.updates).toEqual([]);
  });
});
