import { afterEach, describe, expect, it, vi } from "vitest";

import { applyDocsSsrCacheKeyHeaders } from "../server/ssr-cache";

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
});
