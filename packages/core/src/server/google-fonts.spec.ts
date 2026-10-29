import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GoogleFontsRuntime } from "./google-fonts.js";

type GoogleFontsModule = typeof import("./google-fonts.js");

let fonts: GoogleFontsModule;

beforeEach(async () => {
  vi.resetModules();
  fonts = await import("./google-fonts.js");
});

const catalogBody = (familyMetadataList: unknown[]) =>
  `)]}'\n${JSON.stringify({ familyMetadataList })}`;

function runtimeReturning(...responses: Array<() => Response>) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next();
  });
  const runtime: GoogleFontsRuntime = {
    fetch: fetch as unknown as GoogleFontsRuntime["fetch"],
  };
  return { fetch, runtime };
}

describe("Google Fonts catalog", () => {
  it("parses current and legacy variant keys, axes, and popularity order", async () => {
    const { runtime } = runtimeReturning(
      () =>
        new Response(
          catalogBody([
            {
              family: "Buda",
              category: "Display",
              popularity: 700,
              fonts: { "300": {} },
              axes: [],
            },
            {
              family: "Inter",
              category: "Sans Serif",
              popularity: 2,
              fonts: { "100": {}, "400": {}, "900": {}, "400i": {} },
              axes: [{ tag: "wght", min: 100, max: 900 }],
            },
            {
              family: "Legacy Serif",
              category: "Serif",
              popularity: 50,
              fonts: { regular: {}, "700italic": {}, bogus: {} },
            },
            { family: "<script>", fonts: { "400": {} } },
            { family: "No Faces", fonts: { bogus: {} } },
          ]),
        ),
    );

    await expect(fonts.readGoogleFontCatalog(runtime)).resolves.toEqual([
      {
        family: "Inter",
        category: "Sans Serif",
        weights: [100, 400, 900],
        italicWeights: [400],
        variable: true,
      },
      {
        family: "Legacy Serif",
        category: "Serif",
        weights: [400],
        italicWeights: [700],
        variable: false,
      },
      {
        family: "Buda",
        category: "Display",
        weights: [300],
        italicWeights: [],
        variable: false,
      },
    ]);
  });

  it("caches a successful read and shares one in-flight request", async () => {
    const { fetch, runtime } = runtimeReturning(
      () =>
        new Response(
          catalogBody([{ family: "Inter", fonts: { "400": {} }, axes: [] }]),
        ),
    );
    const [first, second] = await Promise.all([
      fonts.readGoogleFontCatalog(runtime),
      fonts.readGoogleFontCatalog(runtime),
    ]);
    await fonts.readGoogleFontCatalog(runtime);
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(1);
    const policy = (fetch.mock.calls[0] as unknown[] | undefined)?.at(2) as {
      httpsOnly: boolean;
      maxRedirects: number;
      assertUrlAllowed: (value: string) => void;
    };
    expect(policy).toMatchObject({ httpsOnly: true, maxRedirects: 0 });
    expect(() =>
      policy.assertUrlAllowed("https://fonts.google.com.attacker.test/x"),
    ).toThrow(fonts.GoogleFontError);
  });

  it("throws a typed error for a failed or empty catalog instead of returning no fonts", async () => {
    const { fetch, runtime } = runtimeReturning(
      () => new Response("nope", { status: 500 }),
      () => new Response(catalogBody([])),
      () => new Response("not json"),
      () => new Response(catalogBody([{ family: "Inter", fonts: {} }])),
    );
    await expect(fonts.readGoogleFontCatalog(runtime)).rejects.toMatchObject({
      errorCode: "google_font_search_unavailable",
      statusCode: 503,
    });
    await expect(fonts.readGoogleFontCatalog(runtime)).rejects.toMatchObject({
      errorCode: "google_font_catalog_invalid",
    });
    await expect(fonts.readGoogleFontCatalog(runtime)).rejects.toMatchObject({
      errorCode: "google_font_catalog_invalid",
    });
    await expect(fonts.readGoogleFontCatalog(runtime)).rejects.toMatchObject({
      errorCode: "google_font_catalog_invalid",
    });
    // Failures are not cached: every call went back to Google.
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("filters by family name and keeps catalog order", () => {
    const entry = (family: string) => ({
      family,
      category: "",
      weights: [400],
      italicWeights: [],
      variable: false,
    });
    const catalog = [entry("Roboto"), entry("Inter"), entry("Roboto Mono")];
    expect(
      fonts.filterGoogleFontCatalog(catalog, " ROBO ").map((f) => f.family),
    ).toEqual(["Roboto", "Roboto Mono"]);
    expect(fonts.filterGoogleFontCatalog(catalog, "")).toHaveLength(3);
  });

  it("reads variant keys in both spellings", () => {
    expect(fonts.parseGoogleFontVariant("400i")).toEqual({
      weight: 400,
      italic: true,
    });
    expect(fonts.parseGoogleFontVariant("regular")).toEqual({
      weight: 400,
      italic: false,
    });
    expect(fonts.parseGoogleFontVariant("700italic")).toEqual({
      weight: 700,
      italic: true,
    });
    expect(fonts.parseGoogleFontVariant("1000")).toEqual({
      weight: 1000,
      italic: false,
    });
    expect(fonts.parseGoogleFontVariant("0")).toBeNull();
    expect(fonts.parseGoogleFontVariant("bold")).toBeNull();
  });
});
