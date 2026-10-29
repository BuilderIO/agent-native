// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type GoogleFontCatalogEntry,
  STATIC_GOOGLE_FONTS,
  ensureGoogleFontStylesheets,
  getGoogleFontCatalogState,
  getGoogleFontPreviewStatus,
  googleFontPreviewFamily,
  googleFontPreviewUrl,
  googleFontStylesheetUrl,
  loadGoogleFontCatalog,
  requestGoogleFontPreviews,
  resetGoogleFontsForTests,
  resolveGoogleFont,
  setGoogleFontCatalogLoader,
  settleGoogleFontStylesheets,
} from "./google-fonts.js";

const font = (
  family: string,
  weights: number[],
  italicWeights: number[] = [],
  variable = false,
): GoogleFontCatalogEntry => ({
  family,
  category: "Display",
  weights,
  italicWeights,
  variable,
});

/** Every weight a css2 `family=` value asks for, as `[italic, weight]` pairs. */
function requestedFaces(url: string): Array<[boolean, number]> {
  const family = new URL(url).searchParams.get("family") ?? "";
  const [, spec = ""] = family.split(":");
  const [axes = "", values = ""] = spec.split("@");
  return values.split(";").flatMap((tuple): Array<[boolean, number]> => {
    const parts = tuple.split(",");
    const italic = axes.startsWith("ital") && parts[0] === "1";
    const weight = parts.at(-1) ?? "";
    const [low, high] = weight.split("..").map(Number);
    if (low === undefined || Number.isNaN(low)) {
      throw new Error(`bad weight ${weight}`);
    }
    return high === undefined
      ? [[italic, low]]
      : [
          [italic, low],
          [italic, high],
        ];
  });
}

afterEach(() => {
  resetGoogleFontsForTests();
  document.head.innerHTML = "";
});

describe("css2 URLs", () => {
  it("never asks for a weight or style a family lacks", () => {
    const families = [
      ...STATIC_GOOGLE_FONTS,
      font("Buda", [300]),
      font("Molle", [], [400]),
      font("Caveat", [400, 500, 600, 700], [], true),
      font("Sunflower", [300, 500, 700]),
    ];
    for (const entry of families) {
      const url = googleFontStylesheetUrl(entry);
      if (!url) throw new Error(`no URL for ${entry.family}`);
      for (const [italic, weight] of requestedFaces(url)) {
        expect(
          (italic ? entry.italicWeights : entry.weights).includes(weight),
          `${entry.family} ${italic ? "italic " : ""}${weight}`,
        ).toBe(true);
      }
    }
  });

  it("asks variable families for a range and static ones for each weight", () => {
    expect(
      googleFontStylesheetUrl(font("Inter", [100, 900], [100, 900], true)),
    ).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&display=swap",
    );
    expect(googleFontStylesheetUrl(font("Sunflower", [300, 500, 700]))).toBe(
      "https://fonts.googleapis.com/css2?family=Sunflower:wght@300;500;700&display=swap",
    );
    expect(googleFontStylesheetUrl(font("Molle", [], [400]), "upright")).toBe(
      undefined,
    );
  });

  it("previews several families in one request subset to the shown text", () => {
    const url = googleFontPreviewUrl(
      [font("Buda", [300]), font("Molle", [], [400]), font("Open Sans", [400])],
      "BMOadeln",
    );
    expect(url).toBe(
      "https://fonts.googleapis.com/css2?family=Buda:wght@300&family=Molle:ital,wght@1,400&family=Open+Sans:wght@400&text=BMOadeln&display=swap",
    );
  });
});

describe("resolveGoogleFont", () => {
  it("serves the static snapshot, aliases, and weight-suffixed names", () => {
    expect(resolveGoogleFont("'Work Sans'")?.family).toBe("Work Sans");
    expect(resolveGoogleFont("Montserrat Light")?.family).toBe("Montserrat");
    expect(resolveGoogleFont("Source Sans Pro")?.family).toBe("Source Sans 3");
    expect(resolveGoogleFont("Lobster")).toBeUndefined();
    expect(resolveGoogleFont("Lobster", [font("Lobster", [400])])?.family).toBe(
      "Lobster",
    );
  });
});

describe("catalog store", () => {
  it("stays idle without a loader and reports a failed read as an error", async () => {
    await expect(loadGoogleFontCatalog()).resolves.toEqual({ status: "idle" });
    setGoogleFontCatalogLoader(async () => []);
    const failed = await loadGoogleFontCatalog();
    expect(failed.status).toBe("error");
    expect(getGoogleFontCatalogState().status).toBe("error");
  });

  it("links a catalog-only family once the catalog arrives", async () => {
    let calls = 0;
    setGoogleFontCatalogLoader(async () => {
      calls += 1;
      return [font("Lobster", [400])];
    });
    void ensureGoogleFontStylesheets(["Lobster", "Helvetica Neue"]);
    void ensureGoogleFontStylesheets(["Lobster"]);
    await settleGoogleFontStylesheets();
    const hrefs = [...document.head.querySelectorAll("link")].map(
      (link) => link.href,
    );
    expect(hrefs).toEqual([
      "https://fonts.googleapis.com/css2?family=Lobster:wght@400&display=swap",
    ]);
    expect(calls).toBe(1);
  });
});

describe("preview queue", () => {
  it("batches families, caps concurrent requests, and loads the faces", async () => {
    const pending: Array<() => void> = [];
    const fetchMock = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) =>
          pending.push(() => {
            const families = new URL(url).searchParams
              .getAll("family")
              .map((family) => family.split(":")[0] ?? "");
            resolve(
              new Response(
                families
                  .map(
                    (family) =>
                      `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/l/${family.replace(/ /g, "")}.woff2); }`,
                  )
                  .join("\n"),
              ),
            );
          }),
        ),
    );
    const added: string[] = [];
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(readonly family: string) {}
        load() {
          return Promise.resolve(this);
        }
      },
    );
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { add: (face: { family: string }) => added.push(face.family) },
    });

    const fonts = Array.from({ length: 100 }, (_, index) =>
      font(`Family ${index}`, [400]),
    );
    requestGoogleFontPreviews(fonts);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(firstUrl.searchParams.getAll("family")).toHaveLength(20);

    while (pending.length) {
      pending.shift()?.();
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(getGoogleFontPreviewStatus("Family 99")).toBe("loaded");
    expect(added).toContain(googleFontPreviewFamily("Family 0"));

    requestGoogleFontPreviews(fonts);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    vi.unstubAllGlobals();
  });
});
