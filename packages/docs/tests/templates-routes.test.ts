import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loader,
  meta as genericTemplateMeta,
} from "../app/routes/templates.$slug";
import { AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER } from "@agent-native/core/shared";
import { meta as designTemplateMeta } from "../app/routes/templates.design";
import { meta as slidesTemplateMeta } from "../app/routes/templates.slides";
import { featuredTemplates, templates } from "../app/components/TemplateCard";
import { getTemplateDocsPath } from "../app/components/template-docs";
import { NAV_SECTIONS, type NavItem } from "../app/components/docsNavItems";
import { buildSitemapPaths } from "../app/vite-sitemap-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(__dirname, "..");

function ogImageTitle(meta: Array<Record<string, unknown>>): string | null {
  const image = meta.find(
    (item) => item.property === "og:image" && typeof item.content === "string",
  );
  expect(image?.content).toMatch(
    /^https:\/\/www\.agent-native\.com\/_agent-native\/og-image\.png\?/,
  );
  const url = new URL(image!.content as string);
  expect(url.searchParams.get("v")).toBe(
    AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  );
  return url.searchParams.get("title");
}

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

  it("uses product-specific OG image titles for template pages", () => {
    expect(ogImageTitle(slidesTemplateMeta())).toBe("Agent-Native Slides");
    expect(ogImageTitle(designTemplateMeta())).toBe("Agent-Native Design");
    expect(
      ogImageTitle(genericTemplateMeta({ params: { slug: "assets" } })),
    ).toBe("Agent-Native Assets");
  });

  it("keeps docs sidebar template links aligned with the featured catalog", () => {
    const navTemplateSection = NAV_SECTIONS.find(
      (section) => section.title === "Templates",
    );
    expect(navTemplateSection).toBeDefined();

    // Flatten group children (e.g. the Plans chevron group) so paths nested
    // under a group header are collected too.
    const collectPaths = (items: NavItem[]): string[] =>
      items.flatMap((item) => [
        ...(item.to ? [item.to] : []),
        ...(item.children ? collectPaths(item.children) : []),
      ]);
    const sidebarDocPaths = collectPaths(navTemplateSection!.items);
    const catalogTemplatePaths = featuredTemplates.map(getTemplateDocsPath);

    // Every featured catalog template must be reachable from the sidebar,
    // whether linked at the top level or nested under a group (e.g. Plans).
    // Non-featured templates may still keep direct docs pages without being
    // promoted in the main navigation.
    for (const catalogPath of catalogTemplatePaths) {
      expect(sidebarDocPaths).toContain(catalogPath);
    }

    // Every sidebar link in the Templates section must resolve to a real docs
    // page (never a /templates/ marketing route). Group children may be plain
    // docs pages (e.g. pr-visual-recap), so don't require the template- prefix.
    const docsDir = path.resolve(docsRoot, "../core/docs/content");
    for (const sidebarPath of sidebarDocPaths) {
      expect(sidebarPath).toMatch(/^\/docs\/[a-z0-9-]+$/);
      expect(sidebarPath).not.toMatch(/^\/templates\//);

      const slug = sidebarPath.replace("/docs/", "");
      expect(fs.existsSync(path.join(docsDir, `${slug}.md`))).toBe(true);
    }
  });

  it("maps every template catalog item to a real docs page", () => {
    const docsDir = path.resolve(docsRoot, "../core/docs/content");

    expect(getTemplateDocsPath("video")).toBe("/docs/template-videos");

    for (const template of templates) {
      const docsPath = getTemplateDocsPath(template);
      expect(docsPath).toMatch(/^\/docs\/template-[a-z0-9-]+$/);
      expect(docsPath).not.toMatch(/^\/templates\//);

      const slug = docsPath.replace("/docs/template-", "");
      expect(fs.existsSync(path.join(docsDir, `template-${slug}.md`))).toBe(
        true,
      );
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
