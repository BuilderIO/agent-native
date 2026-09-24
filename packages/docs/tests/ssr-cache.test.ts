import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveSsrCacheHeaders } from "@agent-native/core/server/ssr-handler";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderNetlifyHeaders,
  writeNetlifyHeaders,
} from "../lib/netlify-headers";
import {
  applyCommunityAppSsrCacheHeaders,
  applyDocsSsrCacheKeyHeaders,
  isCloudGettingStartedPath,
} from "../lib/ssr-cache";

const docsNetlifyConfig = readFileSync(
  new URL("../netlify.toml", import.meta.url),
  "utf8",
);

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

  it("recognizes the cloud tab URL with a trailing slash or data suffix", () => {
    expect(
      isCloudGettingStartedPath(
        new URL("https://www.agent-native.com/docs/?tab=cloud"),
      ),
    ).toBe(true);
    expect(
      isCloudGettingStartedPath(
        new URL("https://www.agent-native.com/docs.data?tab=cloud"),
      ),
    ).toBe(true);
    expect(
      isCloudGettingStartedPath(
        new URL("https://www.agent-native.com/docs/?tab=local"),
      ),
    ).toBe(false);
  });

  it("keeps mutable community app routes in the durable cache", () => {
    const communityHeaders = new Headers({
      ...resolveSsrCacheHeaders({}),
      "content-type": "text/html; charset=utf-8",
    });
    applyCommunityAppSsrCacheHeaders(communityHeaders, "/es-es/apps/");
    expect(communityHeaders.get("cache-control")).toBe(
      "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600",
    );
    expect(communityHeaders.get("cdn-cache-control")).toBe(
      "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600",
    );
    expect(communityHeaders.get("netlify-cdn-cache-control")).toBe(
      "public, durable, s-maxage=600, stale-while-revalidate=604800, stale-if-error=3600",
    );

    const staticHeaders = new Headers();
    applyCommunityAppSsrCacheHeaders(staticHeaders, "/docs/getting-started/");
    expect(staticHeaders.get("cache-control")).toBeNull();
  });

  it("preserves deployment-wide cache overrides on mutable community routes", () => {
    vi.stubEnv("AGENT_NATIVE_SSR_CACHE", "5m");
    const durationHeaders = new Headers({
      ...resolveSsrCacheHeaders(),
      "content-type": "text/html; charset=utf-8",
    });
    applyCommunityAppSsrCacheHeaders(durationHeaders, "/apps/");
    expect(durationHeaders.get("cache-control")).toBe(
      "public, max-age=300, stale-while-revalidate=300, stale-if-error=3600",
    );
    expect(durationHeaders.get("netlify-cdn-cache-control")).toBe(
      "public, durable, s-maxage=300, stale-while-revalidate=300, stale-if-error=3600",
    );

    vi.stubEnv("AGENT_NATIVE_SSR_CACHE", "off");
    const disabledHeaders = new Headers({
      ...resolveSsrCacheHeaders(),
      "content-type": "text/html; charset=utf-8",
    });
    applyCommunityAppSsrCacheHeaders(disabledHeaders, "/apps/community/foo/");
    expect(disabledHeaders.get("cache-control")).toBe("no-store");
    expect(disabledHeaders.get("cdn-cache-control")).toBe("no-store");
    expect(disabledHeaders.get("netlify-cdn-cache-control")).toBe("no-store");
  });

  it("does not cache auth-shaped or non-SSR community responses", () => {
    for (const status of [401, 403]) {
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
      });

      applyCommunityAppSsrCacheHeaders(headers, "/apps/", status);

      expect(headers.get("cache-control")).toBeNull();
    }

    const jsonHeaders = new Headers({ "content-type": "application/json" });
    applyCommunityAppSsrCacheHeaders(jsonHeaders, "/apps/", 200);
    expect(jsonHeaders.get("cache-control")).toBeNull();
  });

  it("preserves restrictive provider cache headers", () => {
    const headers = new Headers({
      ...resolveSsrCacheHeaders({}),
      "content-type": "text/html; charset=utf-8",
      "netlify-cdn-cache-control": "no-store",
    });

    applyCommunityAppSsrCacheHeaders(headers, "/apps/");

    expect(headers.get("cache-control")).toBe(
      "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600",
    );
    expect(headers.get("cdn-cache-control")).toBe(
      "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600",
    );
    expect(headers.get("netlify-cdn-cache-control")).toBe("no-store");
  });

  it("keeps prerendered public pages on core's default SWR cache policy", () => {
    const coreHeaders = resolveSsrCacheHeaders({});
    const netlifyHeaders = renderNetlifyHeaders({});

    expect(netlifyHeaders).toContain(
      `Cache-Control: ${coreHeaders["cache-control"]}`,
    );
    expect(netlifyHeaders).toContain(
      `CDN-Cache-Control: ${coreHeaders["cdn-cache-control"]}`,
    );
    expect(netlifyHeaders).toContain(
      `Netlify-CDN-Cache-Control: ${coreHeaders["netlify-cdn-cache-control"]}`,
    );
    expect(netlifyHeaders).toContain("stale-while-revalidate");
    expect(netlifyHeaders).not.toContain("max-age=0");
    expect(netlifyHeaders).not.toContain("must-revalidate");
  });

  it("generates static cache headers from the shared Netlify build", () => {
    expect(docsNetlifyConfig).toContain(
      "NITRO_PRESET=netlify pnpm --filter @agent-native/docs build",
    );
    expect(docsNetlifyConfig).not.toContain("generate-netlify-headers");
    expect(docsNetlifyConfig).toContain('publish = "packages/docs/dist"');
  });

  it("applies the deployment-wide SSR cache override to static pages", () => {
    const netlifyHeaders = renderNetlifyHeaders({
      AGENT_NATIVE_SSR_CACHE: "5m",
    });

    expect(netlifyHeaders).toContain(
      "Cache-Control: public, max-age=300, stale-while-revalidate=300, stale-if-error=3600",
    );
    expect(netlifyHeaders).toContain(
      "Netlify-CDN-Cache-Control: public, durable, s-maxage=300, stale-while-revalidate=300, stale-if-error=3600",
    );
    expect(netlifyHeaders).toContain(
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable",
    );
  });

  it("applies the deployment-wide no-store override to static pages", () => {
    const netlifyHeaders = renderNetlifyHeaders({
      AGENT_NATIVE_SSR_CACHE: "off",
    });

    expect(netlifyHeaders).toContain("/*\n  Cache-Control: no-store");
    expect(netlifyHeaders).toContain("  CDN-Cache-Control: no-store");
    expect(netlifyHeaders).toContain("  Netlify-CDN-Cache-Control: no-store");
    expect(netlifyHeaders).toContain(
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable",
    );
  });

  it("preserves existing Netlify headers when regenerating the policy", () => {
    const publishDir = mkdtempSync(
      path.join(os.tmpdir(), "agent-native-docs-headers-"),
    );

    try {
      const headersPath = path.join(publishDir, "_headers");
      writeFileSync(headersPath, '/*\n  Link: </llms.txt>; rel="llms-txt"\n');
      writeNetlifyHeaders(publishDir, {});
      writeNetlifyHeaders(publishDir, {
        AGENT_NATIVE_SSR_CACHE: "5m",
      });

      const headers = readFileSync(headersPath, "utf8");
      expect(headers).toContain('Link: </llms.txt>; rel="llms-txt"');
      expect(headers).toContain("Cache-Control: public, max-age=300");
      expect(headers.match(/Generated by @agent-native\/core/g)).toHaveLength(
        1,
      );
    } finally {
      rmSync(publishDir, { recursive: true, force: true });
    }
  });
});
