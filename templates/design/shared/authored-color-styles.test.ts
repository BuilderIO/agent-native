// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  authoredMatchesPainted,
  collectAuthoredColorStyles,
  shorthandColorValue,
} from "./authored-color-styles";
import { parseCssColor } from "./color-utils";

function render(html: string): void {
  document.head.innerHTML = "";
  document.body.innerHTML = html;
}

function target(selector = "#t"): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  return element;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.adoptedStyleSheets = [];
  document.documentElement.removeAttribute("style");
});

describe("collectAuthoredColorStyles", () => {
  it("reads a token reference out of a class rule", () => {
    // The case a generated design produces: no inline style at all, so the
    // reference exists only in the rule.
    render(
      `<style>.primary{background-color:var(--cds-background-brand)}</style>
       <button id="t" class="primary">Go</button>`,
    );
    expect(collectAuthoredColorStyles(target())).toEqual({
      backgroundColor: "var(--cds-background-brand)",
    });
  });

  it("returns nothing when no rule or inline style sets a colour", () => {
    render(
      `<style>.primary{padding:4px}</style><button id="t" class="primary">`,
    );
    expect(collectAuthoredColorStyles(target())).toEqual({});
  });

  it("lets a later matching rule win, as the cascade does", () => {
    render(
      `<style>
         .a{color:var(--first)}
         .b{color:var(--second)}
       </style>
       <p id="t" class="a b">x</p>`,
    );
    expect(collectAuthoredColorStyles(target()).color).toBe("var(--second)");
  });

  it("lets an inline declaration beat every rule", () => {
    render(
      `<style>.a{color:var(--from-rule)}</style>
       <p id="t" class="a" style="color:var(--from-inline)">x</p>`,
    );
    expect(collectAuthoredColorStyles(target()).color).toBe(
      "var(--from-inline)",
    );
  });

  it("ignores rules that do not match the element", () => {
    render(
      `<style>.other{color:var(--nope)}</style><p id="t" class="mine">x</p>`,
    );
    expect(collectAuthoredColorStyles(target()).color).toBeUndefined();
  });

  it("collects every colour property it finds", () => {
    render(
      `<style>.a{color:var(--c);background-color:var(--bg);border-color:var(--bc);outline-color:var(--oc)}</style>
       <p id="t" class="a">x</p>`,
    );
    expect(collectAuthoredColorStyles(target())).toEqual({
      color: "var(--c)",
      backgroundColor: "var(--bg)",
      borderColor: "var(--bc)",
      outlineColor: "var(--oc)",
    });
  });

  it("survives a selector the engine cannot parse", () => {
    render(`<style>.a{color:var(--ok)}</style><p id="t" class="a">x</p>`);
    // A rule whose selector throws on .matches() must not abort the whole walk.
    const sheet = document.styleSheets[0] as CSSStyleSheet;
    Object.defineProperty(sheet.cssRules[0], "selectorText", {
      get: () => "::-moz-bogus((",
    });
    expect(() => collectAuthoredColorStyles(target())).not.toThrow();
  });

  it("keeps a plain colour when that is what was authored", () => {
    // Engines differ on whether rule.style normalises the literal, so assert the
    // colour rather than its spelling.
    render(`<style>.a{color:#161616}</style><p id="t" class="a">x</p>`);
    const authored = collectAuthoredColorStyles(target()).color ?? "";
    expect(parseCssColor(authored)).toMatchObject({ r: 22, g: 22, b: 22 });
  });

  it("reads a token out of the background shorthand", () => {
    // A shorthand containing var() cannot be expanded, so CSSOM serialises
    // backgroundColor as "" — indistinguishable from unset.
    render(
      `<style>.primary{background:var(--cds-background-brand);color:#fff}</style>
       <button id="t" class="primary">Go</button>`,
    );
    expect(collectAuthoredColorStyles(target()).backgroundColor).toBe(
      "var(--cds-background-brand)",
    );
  });

  it("ignores a shorthand that carries more than a colour", () => {
    render(
      `<style>.hero{background:url(a.png) no-repeat center}</style>
       <div id="t" class="hero"></div>`,
    );
    expect(
      collectAuthoredColorStyles(target()).backgroundColor,
    ).toBeUndefined();
  });

  it("prefers the longhand when both are declared", () => {
    render(
      `<style>.a{background:var(--short);background-color:var(--long)}</style>
       <div id="t" class="a"></div>`,
    );
    expect(collectAuthoredColorStyles(target()).backgroundColor).toBe(
      "var(--long)",
    );
  });

  it("inherits color from the nearest ancestor rule", () => {
    // The real case: a generated <h1> has no class, so its colour comes from a
    // container rule and only inheritance can name it.
    render(
      `<style>.shell{color:var(--cds-text-primary)}</style>
       <div class="shell"><section><h1 id="t">Hi</h1></section></div>`,
    );
    expect(collectAuthoredColorStyles(target()).color).toBe(
      "var(--cds-text-primary)",
    );
  });

  it("prefers the nearest ancestor when several declare a colour", () => {
    render(
      `<style>.outer{color:var(--far)}.inner{color:var(--near)}</style>
       <div class="outer"><div class="inner"><p id="t">x</p></div></div>`,
    );
    expect(collectAuthoredColorStyles(target()).color).toBe("var(--near)");
  });

  it("does not inherit background-color, which is not inherited in CSS", () => {
    render(
      `<style>.shell{background-color:var(--bg)}</style>
       <div class="shell"><p id="t">x</p></div>`,
    );
    expect(
      collectAuthoredColorStyles(target()).backgroundColor,
    ).toBeUndefined();
  });

  it("reads a token whose name contains digits out of a shorthand", () => {
    render(
      `<style>.card{background:var(--cds-layer-01)}</style>
       <div id="t" class="card"></div>`,
    );
    expect(collectAuthoredColorStyles(target()).backgroundColor).toBe(
      "var(--cds-layer-01)",
    );
  });

  it("reads a rule from an adopted stylesheet", () => {
    // A runtime CSS injector (the Tailwind CDN) puts utility rules here, and
    // adopted sheets are absent from document.styleSheets.
    render(`<div><span id="t" class="up">+18.6%</span></div>`);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(".up{color:#24a148}");
    document.adoptedStyleSheets = [sheet];

    const authored = collectAuthoredColorStyles(target()).color ?? "";
    expect(parseCssColor(authored)).toMatchObject({ r: 36, g: 161, b: 72 });
  });

  it("keeps the token when it does resolve to the painted colour", () => {
    render(
      `<style>:root{--cds-text-primary:#161616}.shell{color:var(--cds-text-primary)}</style>
       <div class="shell"><h1 id="t">Hi</h1></div>`,
    );
    expect(collectAuthoredColorStyles(target()).color).toBe(
      "var(--cds-text-primary)",
    );
  });

  it("pulls the colour out of a border shorthand", () => {
    render(
      `<style>:root{--cds-border-subtle-00:#e0e0e0}.card{border:1px solid var(--cds-border-subtle-00)}</style>` +
        `<div id="t" class="card">x</div>`,
    );
    expect(collectAuthoredColorStyles(target()).borderColor).toBe(
      "var(--cds-border-subtle-00)",
    );
  });

  it("pulls the colour out of a border shorthand written width-last", () => {
    render(
      `<style>:root{--c:#e0e0e0}.card{border:dashed var(--c) thin}</style>` +
        `<div id="t" class="card">x</div>`,
    );
    expect(collectAuthoredColorStyles(target()).borderColor).toBe("var(--c)");
  });

  it("reports no stroke colour for a border shorthand that omits one", () => {
    render(
      `<style>.card{border:1px solid}</style><div id="t" class="card">x</div>`,
    );
    expect(collectAuthoredColorStyles(target()).borderColor).toBeUndefined();
  });

  it("keeps a shadow's token, which computed style would have flattened", () => {
    render(
      `<style>:root{--shadow-color:#24a148}.card{box-shadow:0 2px 4px var(--shadow-color)}</style>` +
        `<div id="t" class="card">x</div>`,
    );
    expect(collectAuthoredColorStyles(target()).boxShadow).toBe(
      "0 2px 4px var(--shadow-color)",
    );
  });

  it("recurses into an unconditional grouping rule, as @layer is", () => {
    // happy-dom does not model @layer, so this builds its CSSLayerBlockRule
    // shape: cssRules, no conditionText, no selectorText of its own.
    render(`<span id="t" class="up">+18.6%</span>`);
    const carrier = document.createElement("style");
    carrier.textContent = ".up{color:var(--cds-support-success)}";
    document.head.append(carrier);
    const inner = (document.styleSheets[0] as CSSStyleSheet).cssRules[0];
    carrier.remove();

    document.adoptedStyleSheets = [
      { cssRules: [{ cssRules: [inner] }] } as unknown as CSSStyleSheet,
    ];
    expect(collectAuthoredColorStyles(target()).color).toBe(
      "var(--cds-support-success)",
    );
  });

  it("lets an !important rule beat a plain inline declaration", () => {
    // CSS order: an important author declaration outranks a normal inline one,
    // so reporting the inline value would name a token that is not painting.
    render(
      `<style>:root{--near:#161616;--far:#161616}.label{color:var(--far) !important}</style>` +
        `<p id="t" class="label" style="color:var(--near)">x</p>`,
    );
    expect(collectAuthoredColorStyles(target()).color).toBe("var(--far)");
  });

  it("lets an important inline declaration win", () => {
    render(
      `<style>:root{--near:#161616;--far:#161616}.label{color:var(--far) !important}</style>` +
        `<p id="t" class="label" style="color:var(--near) !important">x</p>`,
    );
    expect(collectAuthoredColorStyles(target()).color).toBe("var(--near)");
  });

  it("prefers the more specific rule over a later, weaker one", () => {
    render(
      `<style>:root{--color-text:#161616}#t{color:#24a148}.label{color:var(--color-text)}</style>` +
        `<p id="t" class="label">+18.6%</p>`,
    );

    const authored = collectAuthoredColorStyles(target()).color ?? "";
    expect(parseCssColor(authored)).toMatchObject({ r: 36, g: 161, b: 72 });
  });

  it("prefers the more specific token even when both resolve alike", () => {
    // Both tokens are #161616, so the painted colour cannot break the tie and
    // only the cascade can say which token the design actually references.
    render(
      `<style>
         :root{--near:#161616;--far:#161616}
         #t{color:var(--near)}
         .label{color:var(--far)}
       </style>
       <p id="t" class="label">x</p>`,
    );

    expect(collectAuthoredColorStyles(target()).color).toBe("var(--near)");
  });

  it("lets !important beat a more specific rule", () => {
    render(
      `<style>
         :root{--near:#161616;--far:#161616}
         #t{color:var(--near)}
         .label{color:var(--far) !important}
       </style>
       <p id="t" class="label">x</p>`,
    );

    expect(collectAuthoredColorStyles(target()).color).toBe("var(--far)");
  });
});

describe("authoredMatchesPainted", () => {
  it("rejects a candidate that resolves to a different colour than is painted", () => {
    // The wrong-name bug: an ancestor's `color: var(--color-text)` (#161616)
    // reported for an element painting green.
    render(`<div><span id="t">+18.6%</span></div>`);
    document.documentElement.style.setProperty("--color-text", "#161616");
    (target() as HTMLElement).style.setProperty("color", "#24a148");

    expect(authoredMatchesPainted(target(), "color", "var(--color-text)")).toBe(
      false,
    );
  });

  it("accepts a candidate that resolves to the painted colour", () => {
    render(`<div><span id="t">x</span></div>`);
    document.documentElement.style.setProperty("--cds-text-primary", "#161616");
    (target() as HTMLElement).style.setProperty("color", "#161616");

    expect(
      authoredMatchesPainted(target(), "color", "var(--cds-text-primary)"),
    ).toBe(true);
  });

  it("rejects a value the engine cannot parse", () => {
    render(`<div><span id="t">x</span></div>`);
    (target() as HTMLElement).style.setProperty("color", "#161616");
    expect(authoredMatchesPainted(target(), "color", "not-a-colour")).toBe(
      false,
    );
  });
});

describe("shorthandColorValue", () => {
  it("isolates the colour in a border shorthand", () => {
    expect(shorthandColorValue("border", "1px solid var(--cds-border)")).toBe(
      "var(--cds-border)",
    );
  });

  it("isolates the colour whatever order the shorthand uses", () => {
    expect(shorthandColorValue("outline", "dashed var(--c) thin")).toBe(
      "var(--c)",
    );
  });

  it("keeps a var() fallback containing spaces intact", () => {
    expect(
      shorthandColorValue("border", "2px solid var(--c, rgb(1, 2, 3))"),
    ).toBe("var(--c, rgb(1, 2, 3))");
  });

  it("reports nothing for a border shorthand with no colour", () => {
    expect(shorthandColorValue("border", "1px solid")).toBeNull();
  });

  it("reports nothing when the shorthand leaves two candidates", () => {
    expect(shorthandColorValue("border", "var(--a) var(--b) solid")).toBeNull();
  });

  it("does not treat a layered background as a colour", () => {
    expect(
      shorthandColorValue("background", "url(a.png) no-repeat center"),
    ).toBeNull();
  });
});
