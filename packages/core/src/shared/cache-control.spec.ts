import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SSR_CACHE_HEADERS,
  DISABLED_SSR_CACHE_CONTROL,
  DISABLED_SSR_CACHE_HEADERS,
  isSsrCacheEnabled,
  parseSsrCacheSetting,
  resolveSsrCacheHeaders,
  SSR_CACHE_ENV_VAR,
  ssrCacheHeadersForPolicy,
} from "./cache-control.js";

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
        "public, max-age=30, stale-while-revalidate=30, stale-if-error=3600",
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
