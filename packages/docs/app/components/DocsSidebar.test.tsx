import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import DocsSidebar from "./DocsSidebar";

function renderSidebar(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <DocsSidebar />
      </AgentNativeI18nProvider>
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

  it("renders the Plans group as a chevron-only toggle with nested sub-items", () => {
    const html = renderSidebar("/docs/template-plan");

    // "Plans" is a chevron-only group trigger, not a link.
    expect(html).toContain("sidebar-group-trigger");
    expect(html).not.toContain('href="/docs/visual-plans"');

    // The main Plans doc is the first child, plus the two satellites.
    expect(html).toContain("docs-sidebar-subitems");
    const mainDocLink = getLinkMarkup(html, "/docs/template-plan");
    expect(mainDocLink).toContain("sidebar-sublink");
    expect(html).toContain('href="/docs/pr-visual-recap"');
    expect(html).toContain('href="/docs/plan-plugin"');
  });

  it("expands the Templates section and the Plans group on a plan sub-doc", () => {
    const html = renderSidebar("/docs/template-plan");

    expect(html).toContain("Templates");
    expect(html).toContain('aria-expanded="true"');

    // The active child link is highlighted and the group is open.
    const activeLink = getLinkMarkup(html, "/docs/template-plan");
    expect(activeLink).toContain("is-active");
    expect(activeLink).toContain('data-an-prefetch="render"');
  });
});
