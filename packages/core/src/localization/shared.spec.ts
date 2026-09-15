import { describe, expect, it } from "vitest";

import {
  localeDisplayName,
  normalizeLocaleCode,
  normalizeLocalePreference,
  normalizeLocalizationPreference,
  resolveLocaleFromCandidates,
  resolveLocaleFromPreference,
} from "./shared.js";

describe("localization shared helpers", () => {
  it("maps traditional Chinese browser locales to zh-TW", () => {
    expect(normalizeLocaleCode("zh-Hant")).toBe("zh-TW");
    expect(normalizeLocaleCode("zh-Hant-TW")).toBe("zh-TW");
    expect(normalizeLocaleCode("zh-HK")).toBe("zh-TW");
    expect(normalizeLocaleCode("zh-MO")).toBe("zh-TW");
  });

  it("keeps simplified Chinese browser locales on zh-CN", () => {
    expect(normalizeLocaleCode("zh-Hans")).toBe("zh-CN");
    expect(normalizeLocaleCode("zh-SG")).toBe("zh-CN");
    expect(normalizeLocaleCode("zh")).toBe("zh-CN");
  });

  it("uses short native names in compact locale pickers", () => {
    expect(localeDisplayName("en-US")).toBe("English");
    expect(localeDisplayName("pt-BR")).toBe("Português");
    expect(localeDisplayName("zh-CN")).toBe("简体中文");
  });

  it("resolves app-registered BCP-47 locales", () => {
    const supportedLocales = ["en-US", "it-IT"] as const;
    expect(normalizeLocaleCode("it-it", supportedLocales)).toBe("it-IT");
    expect(normalizeLocaleCode("it", supportedLocales)).toBe("it-IT");
    expect(normalizeLocalePreference("it-IT")).toBe("it-IT");
    expect(
      localeDisplayName("it-IT", {
        "it-IT": {
          code: "it-IT",
          englishName: "Italian",
          nativeName: "Italiano",
          dir: "ltr",
        },
      }),
    ).toBe("Italiano");
  });

  it("keeps preferences and fallbacks inside an app registry", () => {
    expect(normalizeLocalizationPreference("it-IT", ["en-US"]).locale).toBe(
      "system",
    );
    expect(resolveLocaleFromCandidates([], ["it-IT"])).toBe("it-IT");
    expect(resolveLocaleFromPreference("it-IT", [], ["en-US"])).toBe("en-US");
  });
});
