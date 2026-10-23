import { describe, expect, it, vi } from "vitest";

import {
  type GoogleFontsRuntime,
  GoogleFontError,
  downloadGoogleFont,
  searchGoogleFonts,
} from "./google-fonts";

const catalogBody = `)]}'\n${JSON.stringify({
  familyMetadataList: [
    {
      family: "Inter",
      category: "sans-serif",
      popularity: 10,
      fonts: { regular: {}, "700italic": {} },
    },
    {
      family: "Unrelated Display",
      category: "display",
      popularity: 20,
      fonts: { regular: {} },
    },
  ],
})}`;

const validFontResponse = () =>
  new Response(new Uint8Array([119, 79, 70, 50, 1, 2]), {
    headers: { "content-type": "font/woff2" },
  });

describe("Google Fonts catalog and binary import", () => {
  it("bounds catalog results, validates exact hosts, variants, MIME, and font bytes", async () => {
    const cssBody =
      '@font-face{src:url("https://fonts.gstatic.com/s/inter/v18/inter.woff2")}';
    const fetchMock = vi.fn(
      async (
        input: string | URL | Request,
        _init?: RequestInit,
        _policy?: unknown,
      ) => {
        const url = String(input);
        if (url === "https://fonts.google.com/metadata/fonts") {
          return new Response(catalogBody, {
            headers: { "content-type": "application/json" },
          });
        }
        if (new URL(url).origin === "https://fonts.googleapis.com") {
          return new Response(cssBody, {
            headers: { "content-type": "text/css" },
          });
        }
        return validFontResponse();
      },
    );
    const runtime: GoogleFontsRuntime = {
      fetch: fetchMock as unknown as GoogleFontsRuntime["fetch"],
    };

    await expect(searchGoogleFonts(" inter ", runtime)).resolves.toEqual([
      {
        family: "Inter",
        category: "sans-serif",
        variants: ["regular", "700italic"],
      },
    ]);
    await expect(
      downloadGoogleFont("Inter", "700italic", runtime),
    ).resolves.toMatchObject({
      family: "Inter",
      variant: "700italic",
      extension: "woff2",
      mimeType: "font/woff2",
      data: Buffer.from([119, 79, 70, 50, 1, 2]),
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [catalogUrl, _catalogInit, catalogPolicy] = fetchMock.mock.calls[0]!;
    expect(String(catalogUrl)).toBe("https://fonts.google.com/metadata/fonts");
    expect(catalogPolicy).toMatchObject({ httpsOnly: true, maxRedirects: 0 });
    expect(() =>
      (
        catalogPolicy as unknown as { assertUrlAllowed: (value: string) => URL }
      ).assertUrlAllowed(
        "https://fonts.google.com.attacker.test/metadata/fonts",
      ),
    ).toThrow(GoogleFontError);

    const maliciousCssRuntime: GoogleFontsRuntime = {
      fetch: vi.fn(async (input: string | URL | Request) =>
        new URL(String(input)).origin === "https://fonts.googleapis.com"
          ? new Response(
              '@font-face{src:url("https://attacker.test/font.woff2")}',
              { headers: { "content-type": "text/css" } },
            )
          : new Response(null, { status: 500 }),
      ) as unknown as GoogleFontsRuntime["fetch"],
    };
    await expect(
      downloadGoogleFont("Inter", "regular", maliciousCssRuntime),
    ).rejects.toMatchObject({ errorCode: "google_font_file_unavailable" });

    const invalidBinaryRuntime: GoogleFontsRuntime = {
      fetch: vi.fn(async (input: string | URL | Request) =>
        new URL(String(input)).origin === "https://fonts.googleapis.com"
          ? new Response(cssBody, { headers: { "content-type": "text/css" } })
          : new Response("not a font", {
              headers: { "content-type": "text/html" },
            }),
      ) as unknown as GoogleFontsRuntime["fetch"],
    };
    await expect(
      downloadGoogleFont("Inter", "regular", invalidBinaryRuntime),
    ).rejects.toMatchObject({ errorCode: "google_font_file_invalid" });
  });
});
