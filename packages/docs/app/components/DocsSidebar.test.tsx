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
    expect(html).not.toContain('href="/docs/creating-templates"');
  });
});
