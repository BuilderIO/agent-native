import { describe, expect, it } from "vitest";

import { listBuiltInDeckTemplates } from "./deck-templates.js";
import {
  legacySlideDesignTokensFromHtml,
  legacySlideHtmlToSource,
} from "./legacy-slide-source.js";
import { renderSlideSource } from "./slide-source.js";
import { prepareReactSlideSource } from "./slide-worker-runtime.js";

describe("built-in legacy slide conversion", () => {
  it("converts every built-in page to self-contained source and script-free HTML", () => {
    for (const template of listBuiltInDeckTemplates()) {
      for (const slide of template.slides) {
        const source = legacySlideHtmlToSource(slide.content);
        prepareReactSlideSource(source);
        const html = renderSlideSource(source, new Map());

        expect(source).toContain("export default function Slide");
        expect(html).not.toMatch(/<\/?(?:script|style|iframe|link)\b/i);
        expect(html).not.toMatch(/\sclass=/i);
        expect(html).toContain("transform:scale(2)");
      }
    }
  });

  it("converts scalar and multiple inline styles to valid React style objects", () => {
    const scalar = legacySlideHtmlToSource('<div style="color:red">x</div>');
    const multiple = legacySlideHtmlToSource(
      '<div style="color:red;font-size:24px">x</div>',
    );

    expect(scalar).toContain('<div style={{"color": "red"}}>');
    expect(multiple).toContain(
      '<div style={{"color": "red", "fontSize": "calc(24px * var(--deck-body-scale))"}}>',
    );
    expect(() => prepareReactSlideSource(scalar)).not.toThrow();
    expect(() => prepareReactSlideSource(multiple)).not.toThrow();
  });

  it("converts the static list-style reset without allowing resource styles", () => {
    const source = legacySlideHtmlToSource(
      '<ol style="list-style:none">x</ol>',
    );
    const resourceSource = legacySlideHtmlToSource(
      '<ol style="list-style:url(https://example.invalid/marker.svg)">x</ol>',
    );

    expect(source).toContain('"listStyleType": "none"');
    expect(() => prepareReactSlideSource(source)).not.toThrow();
    expect(() => renderSlideSource(resourceSource, new Map())).toThrow(
      /CSS property "listStyle" can initiate network requests/,
    );
  });

  it("inlines bounded local custom properties before source validation", () => {
    const source = legacySlideHtmlToSource(`
      <div style="--line: #e2e2e7; --border: var(--line)">
        <span style="border-bottom: 1px solid var(--border)">Inherited</span>
        <span style="--line: #17171c; border-top: 1px solid var(--line)">Overridden</span>
      </div>
    `);

    expect(source).toContain('"borderBottom": "1px solid #e2e2e7"');
    expect(source).toContain('"borderTop": "1px solid #17171c"');
    expect(source).not.toContain('"--line"');
    expect(() => prepareReactSlideSource(source)).not.toThrow();
  });

  it("inlines custom properties from static stylesheet rules", () => {
    const source = legacySlideHtmlToSource(`
      <style>.slide { --line: #e2e2e7; } .slide p { border-bottom: 1px solid var(--line); }</style>
      <div class="slide"><p>Rule</p></div>
    `);

    expect(source).toContain('"borderBottom": "1px solid #e2e2e7"');
    expect(() => prepareReactSlideSource(source)).not.toThrow();
  });

  it("rejects undefined, cyclic, and unsafe local custom properties", () => {
    expect(() =>
      legacySlideHtmlToSource(
        '<div style="border:1px solid var(--missing)">x</div>',
      ),
    ).toThrow(/undefined custom property/);
    expect(() =>
      legacySlideHtmlToSource(
        '<div style="--first:var(--second);--second:var(--first);border:1px solid var(--first)">x</div>',
      ),
    ).toThrow(/cyclic/);
    expect(() =>
      legacySlideHtmlToSource(
        '<div style="--image:url(https://example.invalid/image.png);background:var(--image)">x</div>',
      ),
    ).toThrow(/not a safe static value/);
    expect(() =>
      legacySlideHtmlToSource(
        '<div style="--fallback: var(--missing, #fff); color:var(--fallback)">x</div>',
      ),
    ).toThrow(/unsupported custom property reference/);
  });

  it("bounds custom-property expansion and inheritance", () => {
    const oversizedValue = "x".repeat(513);
    const tooManyProperties = Array.from(
      { length: 65 },
      (_, index) => `--local-${index}:#fff`,
    ).join(";");

    expect(() =>
      legacySlideHtmlToSource(
        `<div style="--oversized:${oversizedValue}">x</div>`,
      ),
    ).toThrow(/not a safe static value/);
    expect(() =>
      legacySlideHtmlToSource(`<div style="${tooManyProperties}">x</div>`),
    ).toThrow(/too many inherited custom properties/);
  });

  it("extracts a validated deck theme from the built-in slide wrapper", () => {
    const tokens = legacySlideDesignTokensFromHtml(
      '<div class="fmd-slide" style="--deck-bg:#142b36;--deck-ink:#f5f7ee;--deck-accent:#d8ed74;--deck-heading-font:Georgia,serif;--deck-body-font:Arial,sans-serif;--deck-radius:0px"></div>',
    );

    expect(tokens).toEqual({
      background: "#142b36",
      text: "#f5f7ee",
      accent: "#d8ed74",
      displayFont: "Georgia",
      bodyFont: "Arial",
      heroScale: 1,
      bodyScale: 1,
      radius: 0,
    });
  });
});
