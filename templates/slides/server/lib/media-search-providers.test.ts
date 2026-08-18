import { describe, expect, it, vi } from "vitest";

import {
  getLogoProviderConfig,
  searchProviderImages,
  searchProviderLogos,
  type MediaSearchRuntime,
} from "./media-search-providers.js";

function runtime(
  options: {
    secrets?: Record<string, string>;
    response?: Response;
  } = {},
): MediaSearchRuntime {
  return {
    resolveSecret: vi.fn(async (key) => options.secrets?.[key] ?? null),
    fetch: vi.fn(async () => options.response ?? new Response("[]")),
  };
}

describe("Slides media search providers", () => {
  it("uses runtime secrets and returns structured Google image results", async () => {
    const provider = runtime({
      secrets: {
        GOOGLE_API_KEY: "google-test-key",
        GOOGLE_SEARCH_CX: "search-engine-id",
      },
      response: Response.json({
        items: [
          {
            link: "https://cdn.example.test/hero.png",
            title: "Hero",
            image: {
              thumbnailLink: "https://cdn.example.test/hero-thumb.png",
              width: 1600,
              height: 900,
            },
          },
        ],
      }),
    });

    await expect(
      searchProviderImages("launch hero", 25, provider),
    ).resolves.toEqual([
      {
        url: "https://cdn.example.test/hero.png",
        thumbnail: "https://cdn.example.test/hero-thumb.png",
        title: "Hero",
        width: 1600,
        height: 900,
      },
    ]);
    const [url] = vi.mocked(provider.fetch).mock.calls[0]!;
    expect(String(url)).toContain("q=launch+hero");
    expect(String(url)).toContain("num=10");
  });

  it("fails clearly when Google image search is not configured", async () => {
    await expect(searchProviderImages("hero", 5, runtime())).rejects.toThrow(
      /GOOGLE_API_KEY and GOOGLE_SEARCH_CX/,
    );
  });

  it("uses Logo.dev search when its runtime secret is configured", async () => {
    const provider = runtime({
      secrets: { LOGO_DEV_SECRET_KEY: "sk_test_logo" },
      response: Response.json([{ name: "Acme", domain: "acme.com" }]),
    });

    await expect(searchProviderLogos("Acme", provider)).resolves.toEqual([
      {
        name: "Acme",
        domain: "acme.com",
        logoUrl: "https://cdn.brandfetch.io/acme.com/logo.png",
        source: "logo.dev",
      },
    ]);
    const [, init] = vi.mocked(provider.fetch).mock.calls[0]!;
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer sk_test_logo",
    );
  });

  it("falls back to deterministic domains without issuing provider requests", async () => {
    const provider = runtime();
    const results = await searchProviderLogos("Acme Corp", provider);

    expect(results[0]).toMatchObject({
      name: "Acme Corp",
      domain: "acmecorp.com",
      source: "domain-guess",
    });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("returns only publishable logo configuration to the UI", async () => {
    const provider = runtime({
      secrets: {
        BRANDFETCH_CLIENT_ID: "brandfetch-client",
        LOGO_DEV_TOKEN: "pk_publishable",
        LOGO_DEV_SECRET_KEY: "sk_server_only",
      },
    });

    await expect(getLogoProviderConfig(provider)).resolves.toEqual({
      brandfetchId: "brandfetch-client",
      logoDevToken: "pk_publishable",
      hasLogoDevSecret: true,
    });
  });
});
