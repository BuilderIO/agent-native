import { describe, expect, it } from "vitest";

import arSA from "@/i18n/ar-SA";
import deDE from "@/i18n/de-DE";
import enUS from "@/i18n/en-US";
import esES from "@/i18n/es-ES";
import frFR from "@/i18n/fr-FR";
import hiIN from "@/i18n/hi-IN";
import jaJP from "@/i18n/ja-JP";
import koKR from "@/i18n/ko-KR";
import ptBR from "@/i18n/pt-BR";
import zhCN from "@/i18n/zh-CN";
import zhTW from "@/i18n/zh-TW";

type InteractCopy = Record<string, string>;

function interactCopy(catalog: unknown): InteractCopy {
  return (catalog as { designEditor: { responsiveInteract: InteractCopy } })
    .designEditor.responsiveInteract;
}

const TRANSLATED = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "es-ES": esES,
  "fr-FR": frFR,
  "de-DE": deDE,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "pt-BR": ptBR,
  "hi-IN": hiIN,
  "ar-SA": arSA,
};

describe("Interact screen picker copy", () => {
  it("calls the control a screen picker in English", () => {
    const copy = interactCopy(enUS);
    expect(copy.screen).toBe("Screen");
    expect(copy.noScreens).toMatch(/screens/i);
    expect(copy.unknownScreen).toMatch(/screen/i);
    for (const key of ["route", "noPages", "unknownPage"]) {
      expect(Object.keys(copy)).not.toContain(key);
    }
  });

  it.each(Object.entries(TRANSLATED))(
    "%s names the screen picker, carries no route key, and has every key English has",
    (_locale, catalog) => {
      const copy = interactCopy(catalog);
      expect(copy.screen).toBeTruthy();
      expect(copy.noScreens).toBeTruthy();
      expect(copy.unknownScreen).toBeTruthy();
      for (const key of ["route", "noPages", "unknownPage"]) {
        expect(Object.keys(copy)).not.toContain(key);
      }
      expect(Object.keys(copy).sort()).toEqual(
        Object.keys(interactCopy(enUS)).sort(),
      );
    },
  );
});

describe("Interact theme picker copy", () => {
  it("names Light, Dark and System in English", () => {
    const copy = interactCopy(enUS);
    expect(copy.themeLight).toBe("Light");
    expect(copy.themeDark).toBe("Dark");
    expect(copy.themeSystem).toBe("System");
  });

  it.each(Object.entries(TRANSLATED))(
    "%s labels all three modes and translates both hints",
    (_locale, catalog) => {
      const copy = interactCopy(catalog);
      expect(copy.themeLight).toBeTruthy();
      expect(copy.themeDark).toBeTruthy();
      expect(copy.themeSystem).toBeTruthy();
      for (const hint of ["themeNoDarkStyles", "themeSystemHint"]) {
        expect(copy[hint]).toBeTruthy();
        expect(copy[hint]).not.toBe(interactCopy(enUS)[hint]);
      }
    },
  );

  it("tells the user what choosing Dark will do", () => {
    expect(interactCopy(enUS).themeNoDarkStyles).toMatch(
      /ask the agent to add them/i,
    );
  });

  it("says System shows the design as authored, using the system setting", () => {
    const hint = interactCopy(enUS).themeSystemHint;
    expect(hint).toMatch(/as authored/i);
    expect(hint).toMatch(/system setting/i);
    expect(hint).not.toMatch(/editor/i);
  });

  it("has no copy for a disabled theme picker, which is hidden instead", () => {
    expect(Object.keys(interactCopy(enUS))).not.toContain("themeUnavailable");
    for (const catalog of Object.values(TRANSLATED)) {
      expect(Object.keys(interactCopy(catalog))).not.toContain(
        "themeUnavailable",
      );
    }
  });
});
