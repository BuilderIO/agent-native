import { beforeEach, describe, expect, it, vi } from "vitest";

const readGoogleFontCatalog = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  readGoogleFontCatalog,
}));

import { GoogleFontError } from "@agent-native/core/server";

import listGoogleFonts from "./list-google-fonts";

const family = (name: string) => ({
  family: name,
  category: "Display",
  weights: [400],
  italicWeights: [],
  variable: false,
});

describe("list-google-fonts", () => {
  beforeEach(() => {
    readGoogleFontCatalog.mockReset();
  });

  it("returns the whole catalog in popularity order, or a filtered slice", async () => {
    readGoogleFontCatalog.mockResolvedValue([
      family("Roboto"),
      family("Lobster"),
      family("Lobster Two"),
    ]);
    await expect(listGoogleFonts.run({})).resolves.toEqual({
      fonts: [family("Roboto"), family("Lobster"), family("Lobster Two")],
      total: 3,
    });
    await expect(
      listGoogleFonts.run({ q: "lobster", limit: 1 }),
    ).resolves.toEqual({ fonts: [family("Lobster")], total: 2 });
  });

  it("fails with a typed error when the catalog cannot be read", async () => {
    readGoogleFontCatalog.mockImplementation(async () => {
      throw new GoogleFontError(
        "Google Fonts search is temporarily unavailable.",
        "google_font_search_unavailable",
        503,
      );
    });
    const failure = await listGoogleFonts.run({}).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(GoogleFontError);
    const { errorCode, statusCode } = failure as {
      errorCode?: unknown;
      statusCode?: unknown;
    };
    expect([errorCode, statusCode]).toEqual(["google_fonts_unavailable", 503]);
  });
});
