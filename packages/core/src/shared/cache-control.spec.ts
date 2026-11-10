import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_RECOVERY_BROWSER_CACHE_CONTROL,
  DEFAULT_SSR_CACHE_HEADERS,
  DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
  DISABLED_SSR_CACHE_CONTROL,
  DISABLED_SSR_CACHE_HEADERS,
  isSsrCacheEnabled,
  parseSsrCacheSetting,
  parseSsrMaxAge,
  resolveSsrCacheHeaders,
  resolveSsrCachePolicy,
  resolveChunkRecoveryCacheHeaders,
  resolveSsrCacheKeyHeaders,
  SSR_CACHE_ENV_VAR,
  SSR_HTML_CONTENT_TYPE,
  SSR_QUERY_CACHE_KEY_HEADER,
  ssrCacheHeadersForPolicy,
  ssrCacheHeadersWithin,
  withSsrHtmlContentType,
} from "./cache-control.js";
import { CHUNK_RECOVERY_QUERY_PARAM } from "./route-chunk-recovery-bootstrap.js";
function envWith(value: string | undefined) {
  return { [SSR_CACHE_ENV_VAR]: value };
}

describe("parseSsrCacheSetting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats unset and on-aliases as the default policy", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "  ",
      "on",
      "ON",
      "default",
      "Default",
      "true",
      "1",
      "yes",
    ]) {
      expect(parseSsrCacheSetting(raw)).toEqual({ kind: "default" });
    }
  });

  it("treats off-aliases as disabled", () => {
    for (const raw of [
      "off",
      "OFF",
      "false",
      "0",
      "no",
      "none",
      "no-store",
      "disabled",
      " Disabled ",
    ]) {
      expect(parseSsrCacheSetting(raw)).toEqual({ kind: "disabled" });
    }
  });

  it("reads a bare number as seconds", () => {
    expect(parseSsrCacheSetting("45")).toEqual({ kind: "maxAge", seconds: 45 });
    expect(parseSsrCacheSetting("45s")).toEqual({
      kind: "maxAge",
      seconds: 45,
    });
    expect(parseSsrCacheSetting(" 30S ")).toEqual({
      kind: "maxAge",
      seconds: 30,
    });
    expect(parseSsrCacheSetting("90 seconds")).toEqual({
      kind: "maxAge",
      seconds: 90,
    });
  });

  it("reads minute and hour suffixes", () => {
    expect(parseSsrCacheSetting("5m")).toEqual({
      kind: "maxAge",
      seconds: 300,
    });
    expect(parseSsrCacheSetting("5min")).toEqual({
      kind: "maxAge",
      seconds: 300,
    });
    expect(parseSsrCacheSetting("2h")).toEqual({
      kind: "maxAge",
      seconds: 7200,
    });
    expect(parseSsrCacheSetting("2 hours")).toEqual({
      kind: "maxAge",
      seconds: 7200,
    });
  });

  it("clamps absurd durations to one year", () => {
    expect(parseSsrCacheSetting("31536001")).toEqual({
      kind: "maxAge",
      seconds: 31_536_000,
    });
    expect(parseSsrCacheSetting("9999h")).toEqual({
      kind: "maxAge",
      seconds: 31_536_000,
    });
  });

  it("treats a zero duration as disabled", () => {
    expect(parseSsrCacheSetting("0s")).toEqual({ kind: "disabled" });
    expect(parseSsrCacheSetting("0m")).toEqual({ kind: "disabled" });
  });

  it("warns and falls back to the default on an unrecognized value", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseSsrCacheSetting("banana")).toEqual({ kind: "default" });
    expect(parseSsrCacheSetting("30 fortnights")).toEqual({ kind: "default" });

    expect(consoleWarn).toHaveBeenCalledTimes(2);
    expect(consoleWarn.mock.calls[0]?.[0]).toContain(SSR_CACHE_ENV_VAR);
  });
});

describe("ssrCacheHeadersForPolicy", () => {
  it("returns a copy of the default headers for the default policy", () => {
    const headers = ssrCacheHeadersForPolicy({ kind: "default" });

    expect(headers).toEqual({ ...DEFAULT_SSR_CACHE_HEADERS });
    expect(headers).not.toBe(DEFAULT_SSR_CACHE_HEADERS);
  });

  it("returns the disabled headers for the disabled policy", () => {
    const headers = ssrCacheHeadersForPolicy({ kind: "disabled" });

    expect(headers).toEqual({ ...DISABLED_SSR_CACHE_HEADERS });
    expect(headers["cache-control"]).toBe(DISABLED_SSR_CACHE_CONTROL);
    expect(headers["cdn-cache-control"]).toBe(DISABLED_SSR_CACHE_CONTROL);
    expect(headers["netlify-cdn-cache-control"]).toBe(
      DISABLED_SSR_CACHE_CONTROL,
    );
  });

  it("mirrors the chosen freshness onto stale-while-revalidate", () => {
    expect(ssrCacheHeadersForPolicy({ kind: "maxAge", seconds: 30 })).toEqual({
      "cache-control":
        "public, max-age=30, stale-while-revalidate=30, stale-if-error=3600",
      "cdn-cache-control":
        "public, max-age=30, stale-while-revalidate=30, stale-if-error=3600",
      "netlify-cdn-cache-control":
        "public, durable, s-maxage=30, stale-while-revalidate=30, stale-if-error=3600",
    });
  });
});

describe("parseSsrMaxAge", () => {
  it("reads whole seconds", () => {
    expect(parseSsrMaxAge("20")).toBe(20);
    expect(parseSsrMaxAge(" 0 ")).toBe(0);
  });

  it("ignores an unset value", () => {
    expect(parseSsrMaxAge(undefined)).toBeNull();
    expect(parseSsrMaxAge(null)).toBeNull();
  });

  it("stores nothing for a value that isn't whole seconds", () => {
    for (const raw of ["", "  ", "-5", "1.5", "20s", "soon"]) {
      expect(parseSsrMaxAge(raw)).toBe(0);
    }
  });

  it("clamps absurd durations to one year", () => {
    expect(parseSsrMaxAge("99999999999")).toBe(31_536_000);
  });
});

describe("ssrCacheHeadersWithin", () => {
  it("keeps a route's copy in shared caches for the window it names", () => {
    expect(ssrCacheHeadersWithin({ kind: "default" }, 20)).toEqual({
      "cache-control": CHUNK_RECOVERY_BROWSER_CACHE_CONTROL,
      "cdn-cache-control": "public, s-maxage=20, stale-while-revalidate=20",
      "netlify-cdn-cache-control":
        "public, durable, s-maxage=20, stale-while-revalidate=20",
    });
  });

  it("never serves a stale copy on origin errors", () => {
    const headers = ssrCacheHeadersWithin({ kind: "default" }, 20);
    for (const value of Object.values(headers)) {
      expect(value).not.toContain("stale-if-error");
    }
  });

  it("never stores a route that asks for zero seconds", () => {
    expect(ssrCacheHeadersWithin({ kind: "default" }, 0)).toEqual(
      DISABLED_SSR_CACHE_HEADERS,
    );
  });

  it("never lengthens the deployment's windows", () => {
    expect(ssrCacheHeadersWithin({ kind: "disabled" }, 20)).toEqual(
      DISABLED_SSR_CACHE_HEADERS,
    );
    expect(
      ssrCacheHeadersWithin({ kind: "maxAge", seconds: 10 }, 20)[
        "netlify-cdn-cache-control"
      ],
    ).toBe("public, durable, s-maxage=10, stale-while-revalidate=10");
    expect(
      ssrCacheHeadersWithin({ kind: "default" }, 31_536_000)[
        "netlify-cdn-cache-control"
      ],
    ).toBe("public, durable, s-maxage=31536000, stale-while-revalidate=604800");
  });

  it("caps each CDN header at its own deployment window", () => {
    const headers = ssrCacheHeadersWithin({ kind: "default" }, 3600);

    expect(headers["cdn-cache-control"]).toBe(
      "public, s-maxage=600, stale-while-revalidate=3600",
    );
    expect(headers["netlify-cdn-cache-control"]).toBe(
      "public, durable, s-maxage=3600, stale-while-revalidate=3600",
    );
  });

  it("caps at the same windows the default policy names", () => {
    expect(DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL).toContain(
      "s-maxage=31536000, stale-while-revalidate=604800",
    );
  });
});

describe("resolveSsrCachePolicy", () => {
  it("reads the deployment policy from the env var", () => {
    expect(resolveSsrCachePolicy(envWith(undefined))).toEqual({
      kind: "default",
    });
    expect(resolveSsrCachePolicy(envWith("off"))).toEqual({
      kind: "disabled",
    });
    expect(resolveSsrCachePolicy(envWith("5m"))).toEqual({
      kind: "maxAge",
      seconds: 300,
    });
  });
});

describe("resolveSsrCacheHeaders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the default headers when the env var is unset", () => {
    expect(resolveSsrCacheHeaders({})).toEqual({
      ...DEFAULT_SSR_CACHE_HEADERS,
    });
  });

  it("returns the disabled headers when the env var opts out", () => {
    expect(resolveSsrCacheHeaders(envWith("off"))).toEqual({
      ...DISABLED_SSR_CACHE_HEADERS,
    });
  });

  it("returns a shortened policy for a duration value", () => {
    expect(resolveSsrCacheHeaders(envWith("5m"))["cache-control"]).toBe(
      "public, max-age=300, stale-while-revalidate=300, stale-if-error=3600",
    );
  });

  it("re-resolves when the env value changes", () => {
    expect(resolveSsrCacheHeaders(envWith("off"))["cache-control"]).toBe(
      DISABLED_SSR_CACHE_CONTROL,
    );
    expect(resolveSsrCacheHeaders(envWith("2h"))["cache-control"]).toBe(
      "public, max-age=7200, stale-while-revalidate=7200, stale-if-error=3600",
    );
    expect(resolveSsrCacheHeaders(envWith(undefined))).toEqual({
      ...DEFAULT_SSR_CACHE_HEADERS,
    });
  });

  it("falls back to the default headers on an unrecognized value", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveSsrCacheHeaders(envWith("banana"))).toEqual({
      ...DEFAULT_SSR_CACHE_HEADERS,
    });
  });
});

describe("resolveChunkRecoveryCacheHeaders", () => {
  it("revalidates recovery shells in browsers and bypasses shared CDNs", () => {
    expect(resolveChunkRecoveryCacheHeaders(DEFAULT_SSR_CACHE_HEADERS)).toEqual(
      {
        "cache-control": CHUNK_RECOVERY_BROWSER_CACHE_CONTROL,
        "cdn-cache-control": DISABLED_SSR_CACHE_CONTROL,
        "netlify-cdn-cache-control": DISABLED_SSR_CACHE_CONTROL,
      },
    );
  });

  it("keeps recovery responses disabled when the deployment opts out", () => {
    expect(
      resolveChunkRecoveryCacheHeaders(DISABLED_SSR_CACHE_HEADERS),
    ).toEqual(DISABLED_SSR_CACHE_HEADERS);
  });
});

describe("resolveSsrCacheKeyHeaders", () => {
  it("narrows query variation on Netlify", () => {
    expect(resolveSsrCacheKeyHeaders({ NETLIFY: "true" })).toEqual({
      "netlify-vary": "query=_routes|index",
    });
    expect(resolveSsrCacheKeyHeaders({ SITE_ID: "site-test" })).toEqual({
      "netlify-vary": "query=_routes|index",
    });
  });

  it("uses full query variation only when requested", () => {
    expect(
      resolveSsrCacheKeyHeaders({ NETLIFY: "true" }, { varyByQuery: true }),
    ).toEqual({ "netlify-vary": "query" });
  });

  it("varies only on the fixed legacy recovery marker when requested", () => {
    expect(
      resolveSsrCacheKeyHeaders(
        { NETLIFY: "true" },
        { varyByLegacyRecovery: true },
      ),
    ).toEqual({
      "netlify-vary": `query=_routes|index|${CHUNK_RECOVERY_QUERY_PARAM}`,
    });
  });

  it("does not emit a Netlify header outside Netlify", () => {
    expect(resolveSsrCacheKeyHeaders({})).toEqual({});
    expect(
      resolveSsrCacheKeyHeaders({ NETLIFY: "true", NETLIFY_LOCAL: "true" }),
    ).toEqual({});
  });
});

describe("withSsrHtmlContentType", () => {
  it("marks query-preserving redirects for full cache-key variation", () => {
    const response = new Response(null, {
      status: 302,
      headers: { location: "/library?from=home" },
    });

    expect(withSsrHtmlContentType(response, { varyByQuery: true })).toBe(
      response,
    );
    expect(response.headers.get("content-type")).toBe(SSR_HTML_CONTENT_TYPE);
    expect(response.headers.get(SSR_QUERY_CACHE_KEY_HEADER)).toBe("query");
  });
});

describe("isSsrCacheEnabled", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is enabled by default and for duration values", () => {
    expect(isSsrCacheEnabled({})).toBe(true);
    expect(isSsrCacheEnabled(envWith("on"))).toBe(true);
    expect(isSsrCacheEnabled(envWith("30s"))).toBe(true);
  });

  it("is disabled for off-aliases", () => {
    expect(isSsrCacheEnabled(envWith("off"))).toBe(false);
    expect(isSsrCacheEnabled(envWith("0"))).toBe(false);
    expect(isSsrCacheEnabled(envWith("none"))).toBe(false);
  });

  it("stays enabled for an unrecognized value", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(isSsrCacheEnabled(envWith("banana"))).toBe(true);
  });
});
describe("withSsrHtmlContentType", () => {
  it("marks an existing redirect as HTML without changing its contract", () => {
    const response = new Response(null, {
      status: 302,
      headers: { location: "/library?from=home" },
    });

    expect(withSsrHtmlContentType(response)).toBe(response);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/library?from=home");
    expect(response.headers.get("content-type")).toBe(SSR_HTML_CONTENT_TYPE);
  });
});
