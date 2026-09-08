import { describe, expect, it } from "vitest";

import { isRedirectedDocsPath } from "../app/components/docs-slug-redirects";
import {
  buildPrerenderPaths,
  isDynamicCommunityPath,
} from "../app/vite-sitemap-plugin";

describe("isRedirectedDocsPath", () => {
  it("excludes docs slugs whose loader answers with a 301", () => {
    expect(isRedirectedDocsPath("/docs/server")).toBe(true);
    expect(isRedirectedDocsPath("/ja-JP/docs/core-philosophy")).toBe(true);
  });

  // Page paths carry the canonical trailing slash. Splitting the raw path put
  // an empty string in the last segment, so every redirected slug read as a
  // real page and would have been prerendered as a 200.
  it("excludes redirected slugs in the canonical trailing-slash form", () => {
    expect(isRedirectedDocsPath("/docs/server/")).toBe(true);
    expect(isRedirectedDocsPath("/docs/actions/")).toBe(true);
    expect(isRedirectedDocsPath("/ja-jp/docs/core-philosophy/")).toBe(true);
  });

  it("keeps real docs pages and non-docs pages", () => {
    expect(isRedirectedDocsPath("/docs/server-overview")).toBe(false);
    expect(isRedirectedDocsPath("/docs/server-overview/")).toBe(false);
    expect(isRedirectedDocsPath("/docs")).toBe(false);
    expect(isRedirectedDocsPath("/docs/")).toBe(false);
    expect(isRedirectedDocsPath("/es-es/docs/")).toBe(false);
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

  it("leaves the Builder-backed community catalog on the SSR path", () => {
    expect(paths).not.toContain("/apps/");
    expect(paths.some((path) => path.startsWith("/apps/community/"))).toBe(
      false,
    );
  });

  it("prerenders published docs and marketing pages", () => {
    expect(paths).toContain("/");
    expect(paths).toContain("/docs/actions-overview/");
    expect(paths).toContain("/docs/what-is-agent-native/");
    expect(paths).toContain("/ja-jp/docs/actions-overview/");
    expect(paths).toContain("/about/");
    expect(paths).toContain("/apps/calendar/");
    expect(paths.every((page) => !isRedirectedDocsPath(page))).toBe(true);

    // Prerendered output lands at the path verbatim, so a mixed-case locale
    // segment here writes a directory the CDN then redirects away from.
    expect(paths.filter((page) => page !== page.toLowerCase())).toEqual([]);
  });

  it("keeps query-sensitive Getting Started roots on the SSR path", () => {
    expect(paths.filter((page) => /\/docs\/$/.test(page))).toEqual([]);
  });

  // No doc is currently marked `draft: true` (agents.mdx, the last one, was
  // removed as a content-free stub), so there's nothing left to exercise the
  // draft-exclusion behavior against. Re-add a test here once a real draft
  // page exists: it should be missing from `paths` (a draft doc's loader
  // 404s unless VITE_SHOW_DRAFTS is set, so prerendering it would freeze a
  // 404 into a 200 static file) while still appearing in `sitemapPaths`.
});

describe("isDynamicCommunityPath", () => {
  it("recognizes localized community routes", () => {
    expect(isDynamicCommunityPath("/es-es/apps/community/nomad/")).toBe(true);
    expect(isDynamicCommunityPath("/apps/community/nomad/")).toBe(true);
    expect(isDynamicCommunityPath("/es-es/apps/calendar/")).toBe(false);
  });
});
