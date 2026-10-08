// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  fillSlideNumberTokensInHtml,
  materializeSlideNumberTokens,
  SLIDE_NUMBER_CSS,
  slideNumberInlineStyle,
  slideNumberRootAttrs,
  slideNumberRootVars,
} from "./slide-number";

function squash(css: string) {
  return css.replace(/\s+/g, " ").trim();
}

function canvas(html: string, attrs = "") {
  document.body.innerHTML = `<div id="root" ${attrs}>${html}</div>`;
  return document.getElementById("root")!;
}

describe("slide-number root props", () => {
  it("emits nothing for a deck-less surface", () => {
    expect(slideNumberRootAttrs(undefined)).toEqual({});
    expect(slideNumberRootVars(undefined)).toEqual({});
    expect(slideNumberInlineStyle(undefined)).toBe("");
  });

  it("carries the position as attributes, variables and inline style", () => {
    const position = { number: 4, count: 8 };
    expect(slideNumberRootAttrs(position)).toEqual({
      "data-slide-index": 4,
      "data-slide-count": 8,
    });
    expect(slideNumberRootVars(position)).toEqual({
      "--slide-index": 4,
      "--slide-count": 8,
    });
    expect(slideNumberInlineStyle(position)).toBe(
      "--slide-index: 4; --slide-count: 8;",
    );
  });
});

describe("SLIDE_NUMBER_CSS", () => {
  it("matches the rules in app/global.css", () => {
    const appCss = fs.readFileSync(
      path.resolve(__dirname, "../app/global.css"),
      "utf8",
    );
    expect(squash(appCss)).toContain(squash(SLIDE_NUMBER_CSS));
  });
});

describe("materializeSlideNumberTokens", () => {
  const footer =
    '<span data-slide-number="pad"></span> / <span data-slide-total="pad"></span> · <span data-slide-number></span> of <span data-slide-total></span>';

  it("fills plain and padded tokens from the canvas root", () => {
    const root = canvas(footer, 'data-slide-index="4" data-slide-count="12"');
    materializeSlideNumberTokens(root);
    expect(root.textContent).toBe("04 / 12 · 4 of 12");
  });

  it("does not pad a number that already has two digits", () => {
    const root = canvas(footer, 'data-slide-index="10" data-slide-count="12"');
    materializeSlideNumberTokens(root);
    expect(root.textContent).toBe("10 / 12 · 10 of 12");
  });

  it("leaves tokens empty on a root with no position", () => {
    const root = canvas(footer);
    materializeSlideNumberTokens(root);
    expect(root.textContent).toBe(" /  ·  of ");
  });
});

describe("materializeSlideNumberTokens root cleanup", () => {
  it("drops the position attributes so the counter rules stop matching", () => {
    const root = canvas(
      "<span data-slide-number></span>",
      'data-slide-index="2" data-slide-count="3"',
    );
    materializeSlideNumberTokens(root);
    expect(root.hasAttribute("data-slide-index")).toBe(false);
    expect(root.hasAttribute("data-slide-count")).toBe(false);
  });
});

describe("fillSlideNumberTokensInHtml", () => {
  const position = { number: 4, count: 12 };

  it("fills plain and padded tokens in saved HTML", () => {
    expect(
      fillSlideNumberTokensInHtml(
        '<p><span data-slide-number="pad"></span> / <span class="t" data-slide-total="pad" style="x:y"></span> · <span data-slide-number></span> of <span data-slide-total></span></p>',
        position,
      ),
    ).toBe(
      '<p><span data-slide-number="pad">04</span> / <span class="t" data-slide-total="pad" style="x:y">12</span> · <span data-slide-number>4</span> of <span data-slide-total>12</span></p>',
    );
  });

  it("leaves tokens that already hold content alone", () => {
    const html = "<span data-slide-number>7</span>";
    expect(fillSlideNumberTokensInHtml(html, position)).toBe(html);
  });
});
