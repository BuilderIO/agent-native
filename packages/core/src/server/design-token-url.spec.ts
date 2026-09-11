import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

import { extractDesignTokensFromUrl } from "./design-token-utils.js";

function response(
  body: string,
  options: {
    status?: number;
    url?: string;
    contentLength?: number;
  } = {},
): Response {
  return {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    url: options.url ?? "",
    headers: new Headers(
      options.contentLength === undefined
        ? undefined
        : { "content-length": String(options.contentLength) },
    ),
    body: null,
    text: async () => body,
  } as unknown as Response;
}

describe("extractDesignTokensFromUrl", () => {
  beforeEach(() => {
    mocks.ssrfSafeFetch.mockReset();
  });

  it("merges tokens from linked stylesheets with page HTML", async () => {
    const pageUrl = "https://example.com/app/";
    const calls: string[] = [];
    mocks.ssrfSafeFetch.mockImplementation(async (url: string) => {
      calls.push(url);
      if (url === pageUrl) {
        return response(
          `<html><head>
            <meta content="A styled page" name="description">
            <meta name="theme-color" content="#334455">
            <style>:root { --brand: #abcdef; }</style>
            <link href="/styles/brand.css" rel="stylesheet">
            <link rel="stylesheet alternate" href="//cdn.example.test/theme.css">
            <link rel="icon" href="/favicon.svg">
            <link rel="preload" href="/ignored.css" as="style">
          </head><body style="--inline: #fedcba; color: hsl(220 30% 20% / 0.9)"><title>ignored</title></body></html>`,
          { url: pageUrl },
        );
      }
      if (url === "https://example.com/styles/brand.css") {
        return response(
          `:root { --brand: #123456; --surface: oklch(70% 0.2 30); }
           @font-face { font-family: "Brand Sans"; src: url(/brand.woff2); }
           @import url("https://fonts.googleapis.com/css2?family=Inter+Tight");
           .button { background: color(display-p3 0.2 0.4 0.6); }`,
        );
      }
      if (url === "https://cdn.example.test/theme.css") {
        return response(`body { background: rgb(12 34 56 / 0.8); }`);
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const result = await extractDesignTokensFromUrl(` ${pageUrl} `);

    expect(calls).toEqual([
      pageUrl,
      "https://example.com/styles/brand.css",
      "https://cdn.example.test/theme.css",
    ]);
    expect(result).toMatchObject({
      url: pageUrl,
      metaDescription: "A styled page",
      themeColor: "#334455",
      cssCustomProperties: {
        "--brand": "#abcdef",
        "--surface": "oklch(70% 0.2 30)",
        "--inline": "#fedcba",
      },
      stylesheetUrls: [
        "https://example.com/styles/brand.css",
        "https://cdn.example.test/theme.css",
      ],
      favicon: "https://example.com/favicon.svg",
    });
    expect(result.colors).toEqual(
      expect.arrayContaining([
        "#abcdef",
        "#123456",
        "oklch(70% 0.2 30)",
        "color(display-p3 0.2 0.4 0.6)",
        "rgb(12 34 56 / 0.8)",
        "hsl(220 30% 20% / 0.9)",
      ]),
    );
    expect(result.fontFaces).toEqual([
      { family: "Brand Sans", src: "url(/brand.woff2)" },
    ]);
    expect(result.googleFonts).toEqual([
      "fonts.googleapis.com/css2?family=Inter+Tight",
    ]);

    expect(mocks.ssrfSafeFetch).toHaveBeenNthCalledWith(
      2,
      "https://example.com/styles/brand.css",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { maxRedirects: 3 },
    );
  });

  it("keeps page extraction and reports stylesheet failures", async () => {
    const pageUrl = "https://example.com/";
    mocks.ssrfSafeFetch.mockImplementation(async (url: string) => {
      if (url === pageUrl) {
        return response(
          '<title>Still useful</title><link rel="stylesheet" href="/broken.css">',
          { url: pageUrl },
        );
      }
      throw new Error(
        "SSRF blocked: refusing to fetch private/internal address",
      );
    });

    const result = await extractDesignTokensFromUrl(pageUrl);

    expect(result.pageTitle).toBe("Still useful");
    expect(result.stylesheetUrls).toBeUndefined();
    expect(result.stylesheetFailures).toEqual([
      {
        url: "https://example.com/broken.css",
        error: expect.stringContaining("SSRF blocked"),
      },
    ]);
  });

  it("fails clearly when the initial page is not successful", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      response("not found", {
        status: 404,
        url: "https://example.com/missing",
      }),
    );

    await expect(
      extractDesignTokensFromUrl("https://example.com/missing"),
    ).rejects.toThrow("Failed to fetch https://example.com/missing: HTTP 404");
  });

  it("does not read a stylesheet past its declared size limit", async () => {
    const pageUrl = "https://example.com/";
    mocks.ssrfSafeFetch.mockImplementation(async (url: string) => {
      if (url === pageUrl) {
        return response('<link rel="stylesheet" href="/too-large.css">', {
          url: pageUrl,
        });
      }
      return response("body { color: #123456; }", {
        contentLength: 256 * 1024 + 1,
      });
    });

    const result = await extractDesignTokensFromUrl(pageUrl);

    expect(result.colors).toBeUndefined();
    expect(result.stylesheetFailures).toEqual([
      {
        url: "https://example.com/too-large.css",
        error: expect.stringContaining("262144-character limit"),
      },
    ]);
  });

  it("normalizes schemeless URLs and rejects unsupported schemes", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      response("<title>Brand</title>", { url: "https://example.com/" }),
    );

    await expect(
      extractDesignTokensFromUrl("example.com"),
    ).resolves.toMatchObject({ url: "https://example.com/" });
    await expect(
      extractDesignTokensFromUrl("ftp://example.com/brand"),
    ).rejects.toThrow("Only http and https URLs are allowed");
  });
});
