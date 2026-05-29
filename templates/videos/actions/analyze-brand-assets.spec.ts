import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({}));

import action, { normalizeBrandWebsiteUrl } from "./analyze-brand-assets";

describe("analyze-brand-assets", () => {
  beforeEach(() => {
    mocks.ssrfSafeFetch.mockReset();
  });

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

  it("fetches website brand data through the SSRF-safe fetch helper", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(
        '<html><head><meta name="theme-color" content="#123456"><title>Brand</title></head></html>',
      ),
    );

    const result = await action.run({ websiteUrl: "example.com" });

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
    expect(result.websiteAnalysis).toMatchObject({
      url: "https://example.com/",
      themeColor: "#123456",
      pageTitle: "Brand",
    });
  });
});
