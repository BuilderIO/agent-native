import path from "node:path";

import { describe, expect, it } from "vitest";

import { isRedirectedDocsPath } from "../app/components/docs-slug-redirects";
import {
  buildPrerenderPaths,
  buildSitemapPaths,
} from "../app/vite-sitemap-plugin";

describe("isRedirectedDocsPath", () => {
  it("excludes docs slugs whose loader answers with a 301", () => {
    expect(isRedirectedDocsPath("/docs/server")).toBe(true);
    expect(isRedirectedDocsPath("/ja-JP/docs/core-philosophy")).toBe(true);
  });

  it("keeps real docs pages and non-docs pages", () => {
    expect(isRedirectedDocsPath("/docs/server-overview")).toBe(false);
    expect(isRedirectedDocsPath("/docs")).toBe(false);
    expect(isRedirectedDocsPath("/apps/server")).toBe(false);
  });

  it("does not treat inherited Object properties as redirects", () => {
    expect(isRedirectedDocsPath("/docs/constructor")).toBe(false);
  });
});

// Each build* call re-reads every doc source and shells out to git, so share
// one result across the assertions rather than paying for it per test.
describe("buildPrerenderPaths", () => {
  const paths = buildPrerenderPaths();
  const sitemapPaths = buildSitemapPaths(
    path.resolve(import.meta.dirname, ".."),
  );

  it("enumerates docs, locale docs, and static marketing pages", () => {
    expect(paths).toContain("/");
    expect(paths).toContain("/docs");
    expect(paths).toContain("/docs/actions-overview");
    expect(paths).toContain("/docs/what-is-agent-native");
    expect(paths).toContain("/ja-JP/docs/actions-overview");
    expect(paths.every((page) => !isRedirectedDocsPath(page))).toBe(true);
  });

  // No doc is currently marked `draft: true` (agents.mdx, the last one, was
  // removed as a content-free stub), so there's nothing left to exercise the
  // draft-exclusion behavior against. Re-add a test here once a real draft
  // page exists: it should be missing from `paths` (a draft doc's loader
  // 404s unless VITE_SHOW_DRAFTS is set, so prerendering it would freeze a
  // 404 into a 200 static file) while still appearing in `sitemapPaths`.
});
