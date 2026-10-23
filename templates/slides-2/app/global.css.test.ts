// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * The `.slide-content <tag>` palette in global.css is a dark-deck fallback for
 * MARKDOWN slides. Raw slide HTML — everything an agent writes through
 * add-slide / update-slide — must keep whatever color its own markup declares.
 *
 * When those defaults reached raw HTML, a light-themed deck rendered its
 * headings and body in the hardcoded white and was illegible, and no edit to
 * the slide could repair it: the color lived in this stylesheet, not in the
 * slide. `data-slide-content-scope` is the seam between the two, and
 * SlideRenderer stamps it on every container that renders slide-authored
 * HTML — the raw-HTML container and any markdown layout whose slide declares
 * its own color. (SlideRenderer.test.tsx covers the stamping itself; this file
 * covers what the stylesheet then does.)
 *
 * happy-dom resolves selector specificity but not `inherit`, so the assertion
 * is on the winning declaration: `inherit` means the slide's own color wins.
 */
const RAW_SLIDE = (inner: string) =>
  '<div class="slide-content" data-slide-content-scope="scope-1">' +
  `<div style="color: rgb(41, 37, 36); background: #fdf6ec">${inner}</div>` +
  "</div>";

const MARKDOWN_LAYOUT_SLIDE = (inner: string) =>
  '<div class="fmd-autofit-scale slide-content" ' +
  'data-slide-content-scope="authored-colors">' +
  `<div style="color: rgb(41, 37, 36); background: #fdf6ec">${inner}</div>` +
  "</div>";

const MARKDOWN_SLIDE = (inner: string) =>
  `<div class="slide-content">${inner}</div>`;

const GLOBAL_CSS = readFileSync(
  path.join(process.cwd(), "app/global.css"),
  "utf8",
);

function rulesFor(selector: string): Record<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = GLOBAL_CSS.match(
    new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^{}]*)\\}`),
  )?.[1];
  if (!body) return {};

  return Object.fromEntries(
    body
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        return [
          declaration.slice(0, separator).trim(),
          declaration.slice(separator + 1).trim(),
        ];
      }),
  );
}

function colorOf(html: string, selector: string): string {
  document.body.innerHTML = html;
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No element for ${selector}`);
  return getComputedStyle(element).color;
}

function backgroundColorOf(html: string, selector: string): string {
  document.body.innerHTML = html;
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No element for ${selector}`);
  return getComputedStyle(element).backgroundColor;
}

function propertyOf(html: string, selector: string, property: string): string {
  document.body.innerHTML = html;
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No element for ${selector}`);
  return getComputedStyle(element).getPropertyValue(property);
}

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
});

describe("Slides 2 editor theme tokens", () => {
  it("keeps the original near-black palette in dark mode and inherits other themes", () => {
    expect(
      rulesFor(
        ':root:not([data-theme-family="agent-native"]).dark [data-slides2-editor]',
      ),
    ).toMatchObject({
      "--background": "0 0% 1%",
      "--surface": "0 0% 1%",
      "--border": "0 0% 14%",
      "--sidebar-border": "0 0% 14%",
    });

    expect(rulesFor("[data-slides2-editor]")).toMatchObject({
      "--slides2-present": "hsl(var(--destructive))",
      "--slides2-present-hover": "var(--destructive)",
    });
    expect(
      rulesFor(
        ':root:not([data-theme-family="agent-native"]) [data-slides2-editor]',
      ),
    ).toMatchObject({
      "--slides2-present": "oklch(0.6 0.2 25)",
      "--slides2-present-hover": "3 64% 53%",
    });

    expect(
      rulesFor(':root[data-theme-family="agent-native"] [data-slides2-editor]'),
    ).toMatchObject({
      "--surface": "var(--card)",
      "--surface-hover": "var(--muted)",
    });
    expect(GLOBAL_CSS).toContain(".light {");
    expect(GLOBAL_CSS).toContain("--surface: 0 0% 96%;");
  });

  it("leaves shared composer and sidebar controls to toolkit styles", () => {
    expect(GLOBAL_CSS).not.toContain(
      '.agent-composer-root [data-agent-composer-slot="editor-input"]',
    );
    expect(GLOBAL_CSS).not.toContain('button[title="Open agent sidebar"]');
  });
});

describe("slide-content text colors", () => {
  const markup: Record<string, string> = {
    h1: "<h1>Text</h1>",
    h2: "<h2>Text</h2>",
    h3: "<h3>Text</h3>",
    p: "<p>Text</p>",
    li: "<ul><li>Text</li></ul>",
    strong: "<strong>Text</strong>",
    em: "<em>Text</em>",
    td: "<table><tbody><tr><td>Text</td></tr></tbody></table>",
    a: '<a href="#">Text</a>',
  };
  for (const [tag, inner] of Object.entries(markup)) {
    it(`lets raw slide HTML own its own <${tag}> color`, () => {
      expect(colorOf(RAW_SLIDE(inner), tag)).toBe("inherit");
    });
    it(`lets a markdown-layout slide own its own <${tag}> color`, () => {
      expect(colorOf(MARKDOWN_LAYOUT_SLIDE(inner), tag)).toBe("inherit");
    });
  }

  it("applies the light-deck default to markdown-rendered slides", () => {
    expect(colorOf(MARKDOWN_SLIDE("<h1>Title</h1>"), "h1")).toBe("#1f2933");
  });

  it("covers raw slide HTML whose root has no fmd-slide class", () => {
    const html =
      '<div class="slide-content" data-slide-content-scope="scope-2">' +
      '<div style="padding: 80px 110px; background: #fdf6ec; color: #292524">' +
      "<h1>Onboarding New Customers</h1></div></div>";
    expect(colorOf(html, "h1")).toBe("inherit");
  });

  it("limits relative code and quote styling to newly authored marks", () => {
    const baseline = document.createElement("style");
    baseline.textContent =
      ".slide-content code { font-size: 16px; white-space: nowrap; }" +
      ".slide-content blockquote { font-size: 20px; font-style: italic; opacity: 0.8; }";
    document.head.appendChild(baseline);

    const existing = RAW_SLIDE(
      '<div style="font-size: 40px; line-height: 1.2"><code>existing</code>' +
        "<blockquote>Existing quote</blockquote></div>",
    );
    expect(propertyOf(existing, "code", "font-size")).toBe("16px");
    expect(propertyOf(existing, "code", "white-space")).toBe("nowrap");
    expect(propertyOf(existing, "blockquote", "font-size")).toBe("20px");
    expect(propertyOf(existing, "blockquote", "font-style")).toBe("italic");
    expect(propertyOf(existing, "blockquote", "opacity")).toBe("0.8");

    const html = RAW_SLIDE(
      '<div style="font-size: 40px; line-height: 1.2">' +
        '<code data-slide-authoring-format="code">inline</code>' +
        '<blockquote data-slide-authoring-format="quote">Quoted text</blockquote></div>',
    );

    expect(propertyOf(html, "code", "font-size")).toBe("35.2px");
    expect(propertyOf(html, "code", "line-height")).toBe("inherit");
    expect(propertyOf(html, "code", "white-space")).toBe("inherit");
    expect(propertyOf(html, "blockquote", "font-size")).toBe("inherit");
    expect(propertyOf(html, "blockquote", "line-height")).toBe("inherit");
    expect(propertyOf(html, "blockquote", "font-style")).toBe("inherit");
    expect(propertyOf(html, "blockquote", "opacity")).toBe("1");

    baseline.remove();
  });

  it("keeps the selected question option's primary background", () => {
    const utilityStyle = document.createElement("style");
    utilityStyle.textContent = String.raw`.bg-primary\/10 { background-color: rgb(1, 2, 3); }`;
    document.head.appendChild(utilityStyle);

    expect(
      backgroundColorOf(
        '<div class="slides-question-flow"><div class="guided-question-flow-options"><button class="bg-primary/10" aria-pressed="true"></button></div></div>',
        "button",
      ),
    ).toBe("rgb(1, 2, 3)");

    utilityStyle.remove();
  });
});
