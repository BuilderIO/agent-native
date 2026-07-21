import { beforeEach, describe, expect, it, vi } from "vitest";

const isBlockedExtensionUrlWithDns = vi.hoisted(() => vi.fn(async () => false));
const ssrfSafeFetch = vi.hoisted(() =>
  vi.fn(
    async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
  ),
);

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
}));

const { LayeredRenderedPageProvider } = await import("./rendered-page.js");
const { WebsiteContextConnector, discoverWebsiteInventory } =
  await import("./website.js");

function response(url: string, body: string, contentType: string): Response {
  const result = new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

describe("website context connector", () => {
  beforeEach(() => {
    isBlockedExtensionUrlWithDns.mockReset();
    isBlockedExtensionUrlWithDns.mockResolvedValue(false);
  });

  it("drops signed query capabilities before website URLs become corpus ids", async () => {
    const connector = new WebsiteContextConnector();
    const inventory = await connector.inventory(
      {
        sourceId: "source-1",
        config: {
          urls: [
            "https://example.com/brand?X-Amz-Signature=secret-value#section",
          ],
        },
      },
      { appId: "assets" },
    );

    expect(inventory.items[0]).toMatchObject({
      externalId: "https://example.com/brand",
      canonicalUrl: "https://example.com/brand",
    });
    expect(JSON.stringify(inventory)).not.toContain("secret-value");
  });

  it("honors robots, follows same-origin sitemaps, and reports bounded inventory", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return response(
          url,
          "User-agent: *\nUser-agent: creative-context\nDisallow: /private\nSitemap: https://example.com/site.xml\nSitemap: https://evil.example.net/stolen.xml",
          "text/plain",
        );
      }
      if (url.endsWith(".xml")) {
        return response(
          url,
          "<urlset><url><loc>https://example.com/about</loc></url><url><loc>https://example.com/private/roadmap</loc></url><url><loc>https://evil.example.net/off-origin</loc></url></urlset>",
          "application/xml",
        );
      }
      return response(
        url,
        '<html><head><title>Example</title></head><body><a href="/product">Product</a><a href="/private/secret">Secret</a></body></html>',
        "text/html",
      );
    });

    const discovered = await discoverWebsiteInventory(
      {
        domains: ["example.com"],
        maxPages: 3,
        maxInventoryBytes: 50_000,
      },
      undefined,
      fetcher as never,
    );
    expect(discovered.references.map((item) => item.url)).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/product",
    ]);
    expect(
      discovered.references.some((item) => item.url.includes("private")),
    ).toBe(false);
    expect(
      discovered.references.some((item) => item.url.includes("evil")),
    ).toBe(false);
    expect(discovered.truncated).toBe(true);
    expect(fetcher).not.toHaveBeenCalledWith(
      "https://evil.example.net/stolen.xml",
      expect.anything(),
      expect.anything(),
    );

    const sitemapOnly = await discoverWebsiteInventory(
      {
        sitemapUrls: ["https://example.com/site.xml"],
        maxPages: 2,
      },
      undefined,
      fetcher as never,
    );
    expect(sitemapOnly.references.map((item) => item.url)).toContain(
      "https://example.com/about",
    );
  });

  it("uses a disclosed SSRF-safe static fallback and blocks private destinations", async () => {
    const staticFetch = vi.fn(async (url: string) =>
      response(
        url,
        '<html><head><title>Brand docs</title><style>:root{--brand:#123456}</style></head><body><h1>API guide</h1><a href="/start">Start</a></body></html>',
        "text/html",
      ),
    );
    const renderer = new LayeredRenderedPageProvider({
      loadPlaywright: async () => null,
      staticFetch: staticFetch as never,
    });
    const rendered = await renderer.render({ url: "https://example.com/docs" });
    expect(rendered).toMatchObject({
      method: "static-html",
      rendered: false,
      title: "Brand docs",
      classification: "documentation",
      confidence: 0.45,
      screenshots: [],
    });
    expect(rendered.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SSRF-safe static HTML fallback"),
      ]),
    );
    expect(rendered.extraction.internalLinks).toContain(
      "https://example.com/start",
    );

    isBlockedExtensionUrlWithDns.mockResolvedValue(true);
    await expect(
      renderer.render({ url: "http://127.0.0.1/internal" }),
    ).rejects.toThrow(/SSRF blocked/i);
  });

  it("aborts private-network browser subresources, not only document navigations", async () => {
    isBlockedExtensionUrlWithDns.mockImplementation(async (url: string) =>
      url.includes("10.0.0.7"),
    );
    const abort = vi.fn(async () => {});
    const continueRoute = vi.fn(async () => {});
    let routeHandler: ((route: unknown) => Promise<void>) | undefined;
    const page = {
      async route(
        _pattern: string,
        handler: (route: unknown) => Promise<void>,
      ) {
        routeHandler = handler;
      },
      async goto() {
        await routeHandler?.({
          request: () => ({
            url: () => "http://10.0.0.7/secret.png",
            isNavigationRequest: () => false,
            resourceType: () => "image",
          }),
          abort,
          continue: continueRoute,
        });
      },
      async title() {
        return "Public page";
      },
      url() {
        return "https://example.com/";
      },
      locator() {
        return { innerText: async () => "Public content" };
      },
      async setViewportSize() {},
      async screenshot() {
        return new Uint8Array([1, 2, 3]);
      },
      async evaluate() {
        return {
          title: "Public page",
          text: "Public content",
          assets: [],
          internalLinks: [],
          designTokens: {
            colors: [],
            typography: [],
            spacing: [],
            radii: [],
            cssVariables: {},
          },
        };
      },
    };
    const browser = {
      contexts: () => [{ pages: () => [page], newPage: async () => page }],
      newContext: async () => ({
        pages: () => [page],
        newPage: async () => page,
      }),
      close: async () => {},
    };
    const renderer = new LayeredRenderedPageProvider({
      loadPlaywright: async () =>
        ({
          chromium: {
            connectOverCDP: async () => browser,
            launch: async () => browser,
          },
        }) as never,
    });

    await renderer.render({
      url: "https://example.com/",
      preferHosted: false,
    });
    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(continueRoute).not.toHaveBeenCalled();
  });

  it("persists rendered desktop/mobile evidence and extracted design signals privately", async () => {
    ssrfSafeFetch.mockResolvedValueOnce(
      new Response(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
        { status: 200, headers: { "content-type": "image/svg+xml" } },
      ),
    );
    const putPrivateBlob = vi.fn(async (input: { mimeType?: string }) => ({
      id: `blob-${putPrivateBlob.mock.calls.length}`,
      provider: "fixture",
      opaque: true as const,
      encrypted: true,
      mimeType: input.mimeType,
    }));
    const connector = new WebsiteContextConnector();
    const config = { urls: ["https://example.com/"] };
    const executionContext = {
      appId: "assets",
      ownerEmail: "owner@example.com",
      putPrivateBlob,
      now: () => new Date("2026-07-16T17:00:00.000Z"),
      renderedPages: {
        async render() {
          return {
            url: "https://example.com/",
            finalUrl: "https://example.com/",
            title: "Example brand",
            text: "Built for creative teams",
            method: "builder-browser" as const,
            rendered: true,
            warnings: [],
            extraction: {
              title: "Example brand",
              text: "Built for creative teams",
              assets: [
                {
                  url: "https://example.com/logo.svg?token=signed-secret",
                  kind: "image" as const,
                },
              ],
              internalLinks: ["https://example.com/about"],
              designTokens: {
                colors: ["#123456"],
                typography: [{ family: "Inter", size: "16px" }],
                spacing: ["16px"],
                radii: ["8px"],
                cssVariables: { "--brand": "#123456" },
              },
            },
            screenshots: [
              {
                viewport: "desktop" as const,
                width: 1440,
                height: 900,
                data: new Uint8Array([1]),
              },
              {
                viewport: "mobile" as const,
                width: 390,
                height: 844,
                data: new Uint8Array([2]),
              },
            ],
            confidence: 0.92,
            classification: "homepage" as const,
            diagnostics: ["captured"],
            metadata: { assetCount: 1, internalLinkCount: 1 },
          };
        },
      },
    };
    const inventory = await connector.inventory(
      { sourceId: "source-1", config },
      executionContext,
    );
    const fetched = await connector.fetch(
      { sourceId: "source-1", config, item: inventory.items[0] },
      executionContext,
    );
    expect(fetched.items[0]).toMatchObject({
      title: "Example brand",
      rawSnapshotBlobRef: expect.stringContaining("creative-context-blob:v1:"),
      thumbnailBlobRef: expect.stringContaining("creative-context-blob:v1:"),
      metadata: {
        confidence: 0.92,
        classification: "homepage",
        extraction: {
          designTokens: {
            colors: ["#123456"],
            cssVariables: { "--brand": "#123456" },
          },
        },
      },
      media: expect.arrayContaining([
        expect.objectContaining({ kind: "document", accessMode: "private" }),
        expect.objectContaining({
          kind: "image",
          width: 1440,
          height: 900,
          accessMode: "private",
        }),
        expect.objectContaining({
          kind: "image",
          width: 390,
          height: 844,
          accessMode: "private",
        }),
        expect.objectContaining({
          kind: "image",
          provenanceUrl: "https://example.com/logo.svg",
          accessMode: "private",
          metadata: expect.objectContaining({ canonicalLogoCandidate: true }),
        }),
      ]),
    });
    expect(JSON.stringify(fetched.items)).not.toContain("signed-secret");
    expect(putPrivateBlob).toHaveBeenCalledTimes(4);
  });

  it("rejects active website SVG assets without retaining their signed URL", async () => {
    ssrfSafeFetch.mockResolvedValueOnce(
      new Response(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.example/pixel"/></svg>',
        { status: 200, headers: { "content-type": "image/svg+xml" } },
      ),
    );
    const connector = new WebsiteContextConnector();
    const config = { urls: ["https://example.com/"] };
    const inventory = await connector.inventory(
      { sourceId: "source-1", config },
      { appId: "assets" },
    );
    const fetched = await connector.fetch(
      { sourceId: "source-1", config, item: inventory.items[0] },
      {
        appId: "assets",
        putPrivateBlob: async () => ({
          id: "snapshot",
          provider: "fixture",
          opaque: true,
          encrypted: true,
        }),
        renderedPages: {
          async render() {
            return {
              url: "https://example.com/",
              finalUrl: "https://example.com/",
              title: "Example",
              text: "Brand",
              method: "builder-browser" as const,
              rendered: true,
              warnings: [],
              extraction: {
                title: "Example",
                text: "Brand",
                assets: [
                  {
                    url: "https://example.com/unsafe.svg?token=never-store",
                    kind: "image" as const,
                  },
                ],
                internalLinks: [],
                designTokens: {
                  colors: [],
                  typography: [],
                  spacing: [],
                  radii: [],
                  cssVariables: {},
                },
              },
              screenshots: [],
              confidence: 0.5,
              classification: "homepage" as const,
              diagnostics: [],
              metadata: {},
            };
          },
        },
      },
    );

    expect(fetched.warnings).toEqual([
      expect.stringContaining("Remote SVG contains an external reference"),
    ]);
    expect(JSON.stringify(fetched)).not.toContain("never-store");
    expect(fetched.items[0]?.media).toHaveLength(1);
  });

  it("bounds hostile rendered extraction arrays and persists a valid compact snapshot", async () => {
    const stored: Uint8Array[] = [];
    const putPrivateBlob = vi.fn(async (input: { data: Uint8Array }) => {
      stored.push(input.data);
      return {
        id: `blob-${stored.length}`,
        provider: "fixture",
        opaque: true as const,
        encrypted: true,
      };
    });
    const repeated = Array.from({ length: 5_000 }, (_, index) => index);
    const connector = new WebsiteContextConnector();
    const inventory = await connector.inventory(
      { sourceId: "source-1", config: { urls: ["https://example.com/"] } },
      { appId: "assets" },
    );
    const fetched = await connector.fetch(
      {
        sourceId: "source-1",
        config: {
          urls: ["https://example.com/"],
          rehostAssets: false,
        },
        item: inventory.items[0],
      },
      {
        appId: "assets",
        putPrivateBlob,
        renderedPages: {
          async render() {
            return {
              url: "https://example.com/",
              finalUrl: "https://example.com/",
              title: "Example",
              text: "x".repeat(3_000_000),
              method: "local-playwright" as const,
              rendered: true,
              warnings: [],
              extraction: {
                title: "Example",
                text: "y".repeat(3_000_000),
                assets: repeated.map((index) => ({
                  url: `https://example.com/${index}.png`,
                  kind: "image" as const,
                })),
                internalLinks: repeated.map(
                  (index) => `https://example.com/${index}`,
                ),
                designTokens: {
                  colors: repeated.map((index) => `rgb(${index},0,0)`),
                  typography: repeated.map((index) => ({
                    family: `Family ${index}`,
                  })),
                  spacing: repeated.map((index) => `${index}px`),
                  radii: repeated.map((index) => `${index}px`),
                  cssVariables: Object.fromEntries(
                    repeated.map((index) => [`--token-${index}`, `${index}px`]),
                  ),
                },
              },
              screenshots: [],
              confidence: 0.9,
              classification: "homepage" as const,
              diagnostics: [],
              metadata: { hostile: "z".repeat(3_000_000) },
            };
          },
        },
      },
    );

    expect(stored[0]?.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(() => JSON.parse(new TextDecoder().decode(stored[0]))).not.toThrow();
    expect(
      (fetched.items[0]?.metadata?.extraction as { assets: unknown[] }).assets,
    ).toHaveLength(500);
    expect(fetched.items[0]?.metadata?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining("snapshot was compacted"),
      ]),
    );
  });
});
