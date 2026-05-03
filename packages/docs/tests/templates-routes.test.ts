import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loader } from "../app/routes/templates.$slug";
import { templates } from "../app/components/TemplateCard";
import { NAV_SECTIONS } from "../app/components/docsNavItems";
import { buildSitemapPaths } from "../app/vite-sitemap-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(__dirname, "..");

describe("template routes", () => {
  it("redirects the registry video folder slug to the public video page", () => {
    expect(() =>
      loader({
        params: { slug: "videos" },
      } as unknown as Parameters<typeof loader>[0]),
    ).toThrow(expect.objectContaining({ status: 301 }));
  });

  it("accepts every template catalog slug on the generic template route", () => {
    for (const template of templates) {
      expect(() =>
        loader({
          params: { slug: template.slug },
        } as unknown as Parameters<typeof loader>[0]),
      ).not.toThrow();
    }

    expect(() =>
      loader({
        params: { slug: "starter" },
      } as unknown as Parameters<typeof loader>[0]),
    ).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("keeps docs sidebar template links aligned with the public catalog", () => {
    const navTemplateSection = NAV_SECTIONS.find(
      (section) => section.title === "Templates",
    );
    expect(navTemplateSection).toBeDefined();

    const sidebarTemplatePaths = navTemplateSection!.items.map(
      (item) => item.to,
    );
    const catalogTemplatePaths = templates.map(
      (template) => `/templates/${template.slug}`,
    );

    // Every catalog template must be reachable from the sidebar — the sidebar
    // is allowed to have additional entries for templates that don't yet have
    // a rich catalog card (e.g. calls, voice, recruiting). The forward-only
    // check still catches catalog drift (a new catalog entry without a
    // sidebar link) without forcing every template to have a card.
    for (const catalogPath of catalogTemplatePaths) {
      expect(sidebarTemplatePaths).toContain(catalogPath);
    }

    for (const sidebarPath of sidebarTemplatePaths) {
      const slug = sidebarPath.replace("/templates/", "");
      expect(() =>
        loader({
          params: { slug },
        } as unknown as Parameters<typeof loader>[0]),
      ).not.toThrow();
    }
  });

  it("includes every public docs page and template page in the sitemap", () => {
    const paths = buildSitemapPaths(docsRoot);
    const docsDir = path.resolve(docsRoot, "../core/docs/content");
    const docPaths = fs
      .readdirSync(docsDir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.replace(/\.md$/, ""))
      .map((slug) => (slug === "getting-started" ? "/docs" : `/docs/${slug}`));

    expect(paths).toContain("/");
    expect(paths).toContain("/templates");
    expect(paths).toContain("/download");

    for (const docPath of docPaths) {
      expect(paths).toContain(docPath);
    }

    for (const template of templates) {
      expect(paths).toContain(`/templates/${template.slug}`);
    }

    expect(paths).not.toContain("/docs/resources");
    expect(paths).not.toContain("/templates/starter");
    expect(paths).not.toContain("/templates/videos");
  });
});
