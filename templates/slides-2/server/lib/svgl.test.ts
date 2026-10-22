import { describe, expect, it, vi } from "vitest";

import {
  fetchSvglLogoSvg,
  MAX_SVGL_LOGO_BYTES,
  normalizeSvglSvgUrl,
  searchSvglLogos,
  SvglError,
} from "./svgl.js";

const svgResponse = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "image/svg+xml" },
  });

describe("SVGL search and import boundaries", () => {
  it("searches the fixed API with a result limit and returns only safe logo fields", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 267,
              title: "Axiom",
              category: "Software",
              route: {
                light: "https://svgl.app/axiom-light.svg",
                dark: "https://svgl.app/axiom-dark.svg",
              },
              url: "https://axiom.co/",
              ignored: "field",
            },
            {
              id: 268,
              title: "Bad result",
              category: "Software",
              route: "https://attacker.example/logo.svg",
            },
          ]),
          { headers: { "content-type": "application/json" } },
        ),
    );

    await expect(
      searchSvglLogos("Axiom", { fetch: fetch as never }),
    ).resolves.toEqual([
      {
        id: 267,
        title: "Axiom",
        category: "Software",
        route: {
          light: "https://svgl.app/axiom-light.svg",
          dark: "https://svgl.app/axiom-dark.svg",
        },
      },
    ]);

    const [requestedUrl, , options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
      { assertUrlAllowed: (url: string) => void },
    ];
    expect(new URL(requestedUrl).origin).toBe("https://api.svgl.app");
    expect(new URL(requestedUrl).searchParams.get("search")).toBe("Axiom");
    expect(new URL(requestedUrl).searchParams.get("limit")).toBe("24");
    expect(() => options.assertUrlAllowed("https://evil.example/")).toThrow(
      /SVGL library/,
    );
  });

  it("treats SVGL's no-match response as an empty result set", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      searchSvglLogos("no-such-logo", { fetch: fetch as never }),
    ).resolves.toEqual([]);
  });

  it("caps validated provider results at the local maximum", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            Array.from({ length: 40 }, (_, index) => ({
              id: index + 1,
              title: `Logo ${index + 1}`,
              category: "Software",
              route: `https://svgl.app/logo-${index + 1}.svg`,
            })),
          ),
          { headers: { "content-type": "application/json" } },
        ),
    );

    const results = await searchSvglLogos("logo", { fetch: fetch as never });
    expect(results).toHaveLength(24);
  });

  it("rejects arbitrary, non-HTTPS, and non-SVG routes", async () => {
    expect(normalizeSvglSvgUrl("http://svgl.app/logo.svg")).toBeNull();
    expect(normalizeSvglSvgUrl("https://svgl.app/logo.png")).toBeNull();
    expect(normalizeSvglSvgUrl("https://cdn.svgl.app/logo.svg")).toBeNull();
    expect(
      normalizeSvglSvgUrl("https://svgl.app@attacker.example/logo.svg"),
    ).toBeNull();

    const fetch = vi.fn();
    await expect(
      fetchSvglLogoSvg("https://attacker.example/logo.svg", {
        fetch: fetch as never,
      }),
    ).rejects.toMatchObject({ errorCode: "svgl_invalid_url" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks every redirect destination and rejects oversized SVG payloads", async () => {
    const redirectingFetch = vi.fn(
      async (
        _url: string,
        _init: RequestInit,
        options: { assertUrlAllowed: (url: string) => void },
      ) => {
        options.assertUrlAllowed("https://outside.example/redirect.svg");
        return svgResponse("<svg />");
      },
    );
    await expect(
      fetchSvglLogoSvg("https://svgl.app/logo.svg", {
        fetch: redirectingFetch as never,
      }),
    ).rejects.toMatchObject({ errorCode: "svgl_invalid_url" });

    const tooLargeFetch = vi.fn(
      async () =>
        new Response(new Uint8Array(MAX_SVGL_LOGO_BYTES + 1), {
          headers: {
            "content-type": "image/svg+xml",
            "content-length": String(MAX_SVGL_LOGO_BYTES + 1),
          },
        }),
    );
    await expect(
      fetchSvglLogoSvg("https://svgl.app/logo.svg", {
        fetch: tooLargeFetch as never,
      }),
    ).rejects.toMatchObject({
      errorCode: "svgl_response_too_large",
      statusCode: 413,
    });
  });

  it("reports malformed provider responses as failures instead of empty results", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("{not json", {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      searchSvglLogos("Axiom", { fetch: fetch as never }),
    ).rejects.toBeInstanceOf(SvglError);
  });
});
