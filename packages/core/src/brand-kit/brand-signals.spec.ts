import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

import {
  normalizeBrandWebsiteUrl,
  extractBrandSignalsFromHtml,
  fetchBrandWebsiteSignals,
} from "./brand-signals.js";

describe("normalizeBrandWebsiteUrl", () => {
  it("normalizes schemeless website URLs to https", () => {
    expect(normalizeBrandWebsiteUrl("example.com/brand")).toBe(
      "https://example.com/brand",
    );
  });

  it("rejects unsupported URL schemes before fetching", () => {
    expect(() => normalizeBrandWebsiteUrl("file:///etc/passwd")).toThrow(
      /Only http and https URLs/,
    );
  });

  it("rejects empty input", () => {
    expect(() => normalizeBrandWebsiteUrl("   ")).toThrow(/required/);
  });
});

describe("extractBrandSignalsFromHtml", () => {
  it("extracts theme-color, title, and description", () => {
    const html =
      '<html><head><meta name="theme-color" content="#123456">' +
      "<title>Brand</title>" +
      '<meta name="description" content="A brand"></head></html>';
    expect(extractBrandSignalsFromHtml(html, "https://example.com/")).toEqual({
      url: "https://example.com/",
      themeColor: "#123456",
      pageTitle: "Brand",
      metaDescription: "A brand",
    });
  });
});

describe("fetchBrandWebsiteSignals", () => {
  beforeEach(() => mocks.ssrfSafeFetch.mockReset());

  it("fetches website brand data through the SSRF-safe fetch helper", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(
        '<html><head><meta name="theme-color" content="#123456"><title>Brand</title></head></html>',
      ),
    );

    const result = await fetchBrandWebsiteSignals("example.com");

    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.stringContaining("AgentNative"),
        }),
        signal: expect.any(AbortSignal),
      }),
      { maxRedirects: 3 },
    );
    expect(result).toMatchObject({
      url: "https://example.com/",
      themeColor: "#123456",
      pageTitle: "Brand",
    });
  });

  it("returns an error shape when the page body cannot be read", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue({
      text: async () => {
        throw new Error("network down");
      },
    } as Response);
    const result = await fetchBrandWebsiteSignals("example.com");
    expect(result).toEqual({
      url: "example.com",
      error: expect.stringContaining("network down"),
    });
  });
});
