import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERACT_THEME_MODE,
  detectDarkStyleSupport,
  findDarkAttributeNames,
  INTERACT_THEME_MODES,
  isFontStylesheetHref,
  isInteractThemeMode,
  mentionsPrefersColorScheme,
  normalizeInteractThemeMode,
  parsePreviewColorSchemeFrameName,
  previewColorSchemeFrameName,
  resolveInteractPreviewTheme,
  rewritePrefersColorSchemeMedia,
} from "./preview-color-scheme";

describe("Interact theme modes", () => {
  it("offers Light and Dark, and starts on Light", () => {
    expect([...INTERACT_THEME_MODES]).toEqual(["light", "dark"]);
    expect(DEFAULT_INTERACT_THEME_MODE).toBe("light");
  });

  it("accepts only the two picker values", () => {
    expect(["light", "dark"].every(isInteractThemeMode)).toBe(true);
    expect(isInteractThemeMode("system")).toBe(false);
    expect(isInteractThemeMode("auto")).toBe(false);
    expect(isInteractThemeMode(undefined)).toBe(false);
  });

  it("reads the retired System value as the default, Light", () => {
    expect(normalizeInteractThemeMode("system")).toBe("light");
    expect(normalizeInteractThemeMode("light")).toBe("light");
    expect(normalizeInteractThemeMode("dark")).toBe("dark");
  });

  it("reads nothing from a value that was never a mode", () => {
    expect(normalizeInteractThemeMode("auto")).toBeNull();
    expect(normalizeInteractThemeMode("")).toBeNull();
    expect(normalizeInteractThemeMode(undefined)).toBeNull();
    expect(normalizeInteractThemeMode(null)).toBeNull();
  });
});

describe("preview frame name", () => {
  it("round-trips a scheme through the frame name", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(
        parsePreviewColorSchemeFrameName(previewColorSchemeFrameName(scheme)),
      ).toBe(scheme);
    }
  });

  it("names no frame when no scheme is forced", () => {
    expect(previewColorSchemeFrameName(null)).toBeUndefined();
  });

  it("reads nothing from a name that is not ours or carries an unknown scheme", () => {
    expect(parsePreviewColorSchemeFrameName("checkout-popup")).toBeNull();
    expect(parsePreviewColorSchemeFrameName("")).toBeNull();
    expect(parsePreviewColorSchemeFrameName(undefined)).toBeNull();
    expect(
      parsePreviewColorSchemeFrameName(
        "agent-native:preview-color-scheme:sepia",
      ),
    ).toBeNull();
  });
});

describe("rewritePrefersColorSchemeMedia", () => {
  it("makes a lone dark query always match under a forced dark scheme", () => {
    expect(
      rewritePrefersColorSchemeMedia("(prefers-color-scheme: dark)", "dark"),
    ).toBe("all");
  });

  it("makes a lone dark query never match under a forced light scheme", () => {
    expect(
      rewritePrefersColorSchemeMedia("(prefers-color-scheme: dark)", "light"),
    ).toBe("not all");
  });

  it("handles the light value, spacing and case", () => {
    expect(
      rewritePrefersColorSchemeMedia(
        "( PREFERS-COLOR-SCHEME :Light )",
        "light",
      ),
    ).toBe("all");
    expect(
      rewritePrefersColorSchemeMedia("(prefers-color-scheme:light)", "dark"),
    ).toBe("not all");
  });

  it("treats the boolean form as true for either forced scheme", () => {
    expect(
      rewritePrefersColorSchemeMedia("(prefers-color-scheme)", "dark"),
    ).toBe("all");
    expect(
      rewritePrefersColorSchemeMedia("(prefers-color-scheme)", "light"),
    ).toBe("all");
  });

  it("keeps the rest of a compound query intact", () => {
    expect(
      rewritePrefersColorSchemeMedia(
        "screen and (prefers-color-scheme: dark) and (min-width: 600px)",
        "dark",
      ),
    ).toBe("screen and (min-width: 0px) and (min-width: 600px)");
    expect(
      rewritePrefersColorSchemeMedia(
        "screen and (prefers-color-scheme: dark)",
        "light",
      ),
    ).toBe("screen and (hover: hover) and (hover: none)");
  });

  it("rewrites each query in a comma list independently", () => {
    expect(
      rewritePrefersColorSchemeMedia(
        "print, (prefers-color-scheme: dark), (max-width: 400px)",
        "dark",
      ),
    ).toBe("print, all, (max-width: 400px)");
  });

  it("keeps negation working on the rewritten feature", () => {
    expect(
      rewritePrefersColorSchemeMedia(
        "not all and (prefers-color-scheme: dark)",
        "light",
      ),
    ).toBe("not all and (hover: hover) and (hover: none)");
  });

  it("returns null, not the input, when there is nothing to rewrite", () => {
    expect(rewritePrefersColorSchemeMedia("(min-width: 600px)", "dark")).toBe(
      null,
    );
    expect(rewritePrefersColorSchemeMedia("", "light")).toBe(null);
    expect(mentionsPrefersColorScheme("(prefers-reduced-motion: reduce)")).toBe(
      false,
    );
  });
});

describe("detectDarkStyleSupport", () => {
  it("finds a prefers-color-scheme media rule", () => {
    const result = detectDarkStyleSupport({
      css: ["@media (prefers-color-scheme: dark)", "body{background:#000}"],
    });
    expect(result.support).toBe("yes");
    expect(result.signals).toContain("prefers-color-scheme");
  });

  it("finds a .dark selector but not a lookalike class", () => {
    expect(
      detectDarkStyleSupport({ css: [".dark .card{color:#fff}"] }).signals,
    ).toContain("dark-class");
    expect(
      detectDarkStyleSupport({ css: [":root.dark{--bg:#000}"] }).support,
    ).toBe("yes");
    expect(
      detectDarkStyleSupport({ css: [".darkroom{color:red}", ".dark-mode{}"] })
        .support,
    ).toBe("no");
  });

  it("finds Tailwind's generated dark: utility selector", () => {
    expect(
      detectDarkStyleSupport({
        css: [".dark\\:bg-gray-900:is(.dark *){background:#111}"],
      }).support,
    ).toBe("yes");
  });

  it("finds data-theme and data-mode dark attribute selectors", () => {
    for (const selector of [
      '[data-theme="dark"] .card{}',
      "[data-theme=dark]{}",
      "[data-mode='dark'] body{}",
      '[data-color-scheme="dark"]{}',
      '[data-bs-theme="dark"]{}',
    ]) {
      expect(detectDarkStyleSupport({ css: [selector] }).signals).toContain(
        "dark-attribute",
      );
    }
    expect(
      detectDarkStyleSupport({ css: ['[data-theme="darkish"]{}'] }).support,
    ).toBe("no");
  });

  it("finds light-dark() and a color-scheme that lists dark", () => {
    expect(
      detectDarkStyleSupport({ css: ["a{color:light-dark(#111,#eee)}"] })
        .signals,
    ).toContain("light-dark");
    expect(
      detectDarkStyleSupport({ css: [":root{color-scheme:light dark}"] })
        .signals,
    ).toContain("color-scheme");
    expect(
      detectDarkStyleSupport({ css: [":root{color-scheme:light}"] }).support,
    ).toBe("no");
  });

  it("finds a Tailwind dark: variant in a class attribute", () => {
    expect(
      detectDarkStyleSupport({
        html: '<div class="bg-white dark:bg-gray-900 p-4">x</div>',
      }).signals,
    ).toEqual(["dark-variant-class"]);
    expect(
      detectDarkStyleSupport({
        html: "<div class='md:hover:dark:text-white'>x</div>",
      }).support,
    ).toBe("yes");
  });

  it("does not read a dark: variant out of text content or other attributes", () => {
    expect(
      detectDarkStyleSupport({
        html: '<p title="dark:bg-x">Theme dark: on</p><div class="bg-white">',
      }).support,
    ).toBe("no");
  });

  it("reports no only when everything was readable", () => {
    expect(
      detectDarkStyleSupport({ css: ["body{margin:0}"], html: "<p>hi</p>" }),
    ).toEqual({ support: "no", signals: [] });
  });

  it("reports unknown, not no, when a stylesheet was unreadable", () => {
    expect(
      detectDarkStyleSupport({
        css: ["body{margin:0}"],
        unreadableStylesheets: 1,
      }).support,
    ).toBe("unknown");
  });

  it("reports unknown when the scan was cut short", () => {
    expect(
      detectDarkStyleSupport({ css: ["body{margin:0}"], truncated: true })
        .support,
    ).toBe("unknown");
  });

  it("still reports yes when something was unreadable but a signal was found", () => {
    expect(
      detectDarkStyleSupport({
        css: [".dark{}"],
        unreadableStylesheets: 2,
        truncated: true,
      }).support,
    ).toBe("yes");
  });
});

describe("findDarkAttributeNames", () => {
  it("returns each attribute the CSS keys a dark theme on", () => {
    expect(
      findDarkAttributeNames([
        '[data-theme="dark"] .a{}',
        "[data-bs-theme=dark]{}",
        ".b{}",
        "[data-theme='dark'] .c{}",
      ]).sort(),
    ).toEqual(["data-bs-theme", "data-theme"]);
  });

  it("returns nothing when no selector targets a dark attribute", () => {
    expect(findDarkAttributeNames(["a{color:red}", ".dark{}"])).toEqual([]);
  });
});

describe("isFontStylesheetHref", () => {
  it("recognises font-loading stylesheet hosts", () => {
    expect(
      isFontStylesheetHref("https://fonts.googleapis.com/css2?family=Inter"),
    ).toBe(true);
    expect(isFontStylesheetHref("https://use.typekit.net/abc.css")).toBe(true);
  });

  it("does not excuse other hosts, inline sheets or garbage", () => {
    expect(isFontStylesheetHref("https://cdn.example.com/theme.css")).toBe(
      false,
    );
    expect(
      isFontStylesheetHref("https://fonts.googleapis.com.evil.test/a"),
    ).toBe(false);
    expect(isFontStylesheetHref(null)).toBe(false);
    expect(isFontStylesheetHref("not a url")).toBe(false);
  });
});

describe("resolveInteractPreviewTheme", () => {
  it("forces the chosen scheme when the design supports dark", () => {
    expect(
      resolveInteractPreviewTheme({ mode: "dark", availability: "yes" }),
    ).toEqual({
      scheme: "dark",
      displayMode: "dark",
      canPick: true,
      darkAvailable: true,
    });
    expect(
      resolveInteractPreviewTheme({ mode: "light", availability: "yes" }),
    ).toMatchObject({ scheme: "light", displayMode: "light" });
  });

  it("keeps Dark available before the design reports or when it cannot be read in full", () => {
    for (const availability of ["pending", "unknown"] as const) {
      expect(
        resolveInteractPreviewTheme({ mode: "dark", availability }),
      ).toMatchObject({ scheme: "dark", darkAvailable: true });
    }
  });

  it("shows Light, not Dark, and previews light when the design has no dark styles", () => {
    expect(
      resolveInteractPreviewTheme({ mode: "dark", availability: "no" }),
    ).toEqual({
      scheme: "light",
      displayMode: "light",
      canPick: true,
      darkAvailable: false,
    });
  });

  it("leaves Light as Light when the design has no dark styles", () => {
    expect(
      resolveInteractPreviewTheme({ mode: "light", availability: "no" }),
    ).toMatchObject({
      scheme: "light",
      displayMode: "light",
      darkAvailable: false,
    });
  });

  it("leaves the document alone and disables the picker when the page cannot take the bridge", () => {
    expect(
      resolveInteractPreviewTheme({
        mode: "dark",
        availability: "unavailable",
      }),
    ).toEqual({
      scheme: null,
      displayMode: "dark",
      canPick: false,
      darkAvailable: false,
    });
  });
});
