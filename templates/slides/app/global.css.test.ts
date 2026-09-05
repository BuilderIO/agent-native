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
 * slide. `data-slide-content-scope` is set only on the raw-HTML container
 * (SlideRenderer's BlankSlideContent), so it is the seam between the two.
 *
 * happy-dom resolves selector specificity but not `inherit`, so the assertion
 * is on the winning declaration: `inherit` means the slide's own color wins.
 */
const RAW_SLIDE = (inner: string) =>
  '<div class="slide-content" data-slide-content-scope="scope-1">' +
  `<div style="color: rgb(41, 37, 36); background: #fdf6ec">${inner}</div>` +
  "</div>";

const MARKDOWN_SLIDE = (inner: string) =>
  `<div class="slide-content">${inner}</div>`;

function colorOf(html: string, selector: string): string {
  document.body.innerHTML = html;
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No element for ${selector}`);
  return getComputedStyle(element).color;
}

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync(
    path.join(process.cwd(), "app/global.css"),
    "utf8",
  );
  document.head.appendChild(style);
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
  };
  for (const [tag, inner] of Object.entries(markup)) {
    it(`lets raw slide HTML own its own <${tag}> color`, () => {
      expect(colorOf(RAW_SLIDE(inner), tag)).toBe("inherit");
    });
  }

  it("still applies the dark-deck default to markdown-rendered slides", () => {
    expect(colorOf(MARKDOWN_SLIDE("<h1>Title</h1>"), "h1")).toBe("#ffffff");
  });

  it("covers raw slide HTML whose root has no fmd-slide class", () => {
    // The reset used to be scoped to `.fmd-slide`, so agent HTML that omitted
    // the class kept the white heading. This is that exact markup.
    const html =
      '<div class="slide-content" data-slide-content-scope="scope-2">' +
      '<div style="padding: 80px 110px; background: #fdf6ec; color: #292524">' +
      "<h1>Onboarding New Customers</h1></div></div>";
    expect(colorOf(html, "h1")).toBe("inherit");
  });
});
