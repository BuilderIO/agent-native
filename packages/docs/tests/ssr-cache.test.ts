import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyDocsSsrCacheKeyHeaders } from "../lib/ssr-cache";

const docsNetlifyConfig = readFileSync(
  new URL("../netlify.toml", import.meta.url),
  "utf8",
);

const publicStaticHeaderBlock =
  docsNetlifyConfig.match(
    /\[\[headers\]\]\s*for = "\/\*"\s*\[headers\.values\]([\s\S]*?)(?=\n\[\[headers\]\]|\s*$)/,
  )?.[1] ?? "";

describe("Docs SSR cache key wrapper", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves core's full-query key for query-sensitive redirects", () => {
    const headers = new Headers({ "netlify-vary": "query" });

    applyDocsSsrCacheKeyHeaders(headers);

    expect(headers.get("netlify-vary")).toBe("query");
  });

  it("applies the normal narrowed key to ordinary public SSR responses", () => {
    vi.stubEnv("NETLIFY", "true");
    const headers = new Headers();

    applyDocsSsrCacheKeyHeaders(headers);

    expect(headers.get("netlify-vary")).toBe("query=_routes|index");
  });

  it("keeps prerendered public pages on the shared SWR cache policy", () => {
    expect(publicStaticHeaderBlock).toContain(
      'Cache-Control = "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600"',
    );
    expect(publicStaticHeaderBlock).toContain(
      'CDN-Cache-Control = "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600"',
    );
    expect(publicStaticHeaderBlock).toContain(
      'Netlify-CDN-Cache-Control = "public, s-maxage=31536000, stale-while-revalidate=604800, stale-if-error=3600"',
    );
    expect(publicStaticHeaderBlock).not.toContain("max-age=0");
    expect(publicStaticHeaderBlock).not.toContain("must-revalidate");
  });
});
