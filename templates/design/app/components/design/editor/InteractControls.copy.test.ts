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

// oracle-change: removed per-locale key and hint checks; guard:i18n-catalogs owns catalog shape, placeholders and English-value debt
// oracle-change(templates/design/app/components/editor/PromptDialog.startChoice.spec.tsx): source-text greps of PromptDialog.tsx only

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
  // oracle-change: Screens became Pages in UI copy, so the picker reads Page; the keys keep `screen` and still reject route keys
  it("calls the control a page picker in English", () => {
    const copy = interactCopy(enUS);
    expect(copy.screen).toBe("Page");
    expect(copy.noScreens).toMatch(/pages/i);
    expect(copy.unknownScreen).toMatch(/page/i);
    for (const key of ["route", "noPages", "unknownPage"]) {
      expect(Object.keys(copy)).not.toContain(key);
    }
  });
});

describe("Interact theme picker copy", () => {
  it("names Light, Dark and System in English", () => {
    const copy = interactCopy(enUS);
    expect(copy.themeLight).toBe("Light");
    expect(copy.themeDark).toBe("Dark");
    expect(copy.themeSystem).toBe("System");
  });

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
