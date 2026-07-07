import { existsSync } from "node:fs";
import { join } from "node:path";

import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { docsSlugFromPathname } from "./docs-locale";
import { getDocsNavItems } from "./docsNavItems";
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

function docsContentDir() {
  const candidates = [
    join(process.cwd(), "../core/docs/content"),
    join(process.cwd(), "packages/core/docs/content"),
  ];
  const dir = candidates.find((candidate) => existsSync(candidate));

  if (!dir) {
    throw new Error(
      `Could not find docs content directory from ${process.cwd()}`,
    );
  }

  return dir;
}

function hasDocSource(slug: string) {
  const contentDir = docsContentDir();
  return [".mdx", ".md"].some((extension) =>
    existsSync(join(contentDir, `${slug}${extension}`)),
  );
}

describe("DocsSidebar", () => {
  it("keeps every nav destination backed by a docs source file", () => {
    const missing = getDocsNavItems()
      .map((item) => ({
        path: item.to,
        slug: docsSlugFromPathname(item.to),
      }))
      .filter(
        (item): item is { path: string; slug: string } =>
          typeof item.slug === "string",
      )
      .filter((item) => !hasDocSource(item.slug));

    expect(missing).toEqual([]);
  });

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

  it("renders the Toolkit group as a chevron-only toggle with focused child docs", () => {
    const html = renderSidebar("/docs/toolkit-collaboration-ui");
    const toolkitLinks = getDocsNavItems().filter(
      (item) =>
        item.to === "/docs/agent-native-toolkit" ||
        item.to.startsWith("/docs/toolkit-"),
    );

    expect(html).toContain("Toolkit");
    expect(html).toContain("sidebar-group-trigger");
    expect(toolkitLinks.length).toBeGreaterThan(0);
    for (const item of toolkitLinks) {
      expect(html).toContain(`href="${item.to}"`);
    }

    const activeLink = getLinkMarkup(html, "/docs/toolkit-collaboration-ui");
    expect(activeLink).toContain("is-active");
  });

  it("expands the Apps section and the Plans group on a plan sub-doc", () => {
    const html = renderSidebar("/docs/template-plan");

    expect(html).toContain("Apps");
    expect(html).toContain('aria-expanded="true"');

    // The active child link is highlighted and the group is open.
    const activeLink = getLinkMarkup(html, "/docs/template-plan");
    expect(activeLink).toContain("is-active");
    expect(activeLink).toContain('data-an-prefetch="render"');
  });
});
