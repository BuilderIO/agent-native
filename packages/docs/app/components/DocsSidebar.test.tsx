import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import DocsSidebar from "./DocsSidebar";

function renderSidebar(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <DocsSidebar />
    </MemoryRouter>,
  );
}

function getLinkMarkup(html: string, href: string) {
  const match = html.match(new RegExp(`<a\\b[^>]*href="${href}"[^>]*>`));

  if (!match) {
    throw new Error(`Expected sidebar link for ${href}`);
  }

  return match[0];
}

describe("DocsSidebar", () => {
  it("keeps the overview section expanded without a toggle", () => {
    const html = renderSidebar("/docs");

    expect(html).toContain("Overview");
    expect(html).toContain('href="/docs"');
    expect(html).not.toContain('aria-controls="docs-sidebar-section-0"');
  });

  it("expands the section that contains the active docs page", () => {
    const html = renderSidebar("/docs/tracking");

    expect(html).toContain("Tracking &amp; Analytics");
    expect(html).toContain('href="/docs/tracking"');
    expect(html).toContain('aria-expanded="true"');

    const activeLink = getLinkMarkup(html, "/docs/tracking");
    const closedLink = getLinkMarkup(html, "/docs/creating-templates");

    expect(activeLink).toContain('data-an-prefetch="render"');
    expect(activeLink).not.toContain("tabindex");
    expect(closedLink).not.toContain("data-an-prefetch");
    expect(closedLink).toContain('tabindex="-1"');
    expect(html).toContain('data-state="closed" aria-hidden="true" inert=""');
  });

  it("renders plan docs as nested sub-items under the Plans template", () => {
    const html = renderSidebar("/docs/template-plan");

    // Parent template link and its nested sub-tree both render.
    expect(html).toContain('href="/docs/template-plan"');
    expect(html).toContain("docs-sidebar-subitems");

    const visualPlansLink = getLinkMarkup(html, "/docs/visual-plans");
    expect(visualPlansLink).toContain("sidebar-sublink");
    expect(html).toContain('href="/docs/pr-visual-recap"');
    expect(html).toContain('href="/docs/plan-plugin"');
  });

  it("expands the Templates section when on a nested plan sub-doc", () => {
    const html = renderSidebar("/docs/visual-plans");

    expect(html).toContain("Templates");
    expect(html).toContain('aria-expanded="true"');

    const activeLink = getLinkMarkup(html, "/docs/visual-plans");
    expect(activeLink).toContain("is-active");
    expect(activeLink).toContain('data-an-prefetch="render"');
  });
});
