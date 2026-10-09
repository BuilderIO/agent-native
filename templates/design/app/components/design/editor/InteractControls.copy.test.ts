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

describe("Interact theme picker copy", () => {
  it("names Light and Dark in English and has no System label", () => {
    const copy = interactCopy(enUS);
    expect(copy.themeLight).toBe("Light");
    expect(copy.themeDark).toBe("Dark");
    expect(Object.keys(copy)).not.toContain("themeSystem");
  });

  it.each(Object.entries(TRANSLATED))(
    "%s has no System label and translates the Dark hint",
    (_locale, catalog) => {
      const copy = interactCopy(catalog);
      expect(Object.keys(copy)).not.toContain("themeSystem");
      expect(copy.themeLight).toBeTruthy();
      expect(copy.themeDark).toBeTruthy();
      expect(copy.themeNoDarkStyles).toBeTruthy();
      expect(copy.themeNoDarkStyles).not.toBe(
        interactCopy(enUS).themeNoDarkStyles,
      );
    },
  );

  it("tells the user what choosing Dark will do", () => {
    expect(interactCopy(enUS).themeNoDarkStyles).toMatch(
      /ask the agent to add them/i,
    );
  });
});
