import { describe, expect, it } from "vitest";

import { i18nCatalog } from "./i18n";
import arSA from "./i18n/ar-SA";
import deDE from "./i18n/de-DE";
import enUS from "./i18n/en-US";
import esES from "./i18n/es-ES";
import frFR from "./i18n/fr-FR";
import hiIN from "./i18n/hi-IN";
import jaJP from "./i18n/ja-JP";
import koKR from "./i18n/ko-KR";
import ptBR from "./i18n/pt-BR";
import zhCN from "./i18n/zh-CN";
import zhTW from "./i18n/zh-TW";

const localeMessages = {
  "en-US": enUS,
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
} as const;

const requiredKeys = [
  "navigation.agents",
  "navigation.triage",
  "factoryRoute.rulesTitle",
  "factoryRoute.createApp",
  "factoryRoute.shadowLabel",
  "factoryRoute.rulesGuidance",
  "factoryRoute.ruleNameLabel",
  "factoryRoute.defaultFactoryLabel",
  "factoryRoute.savedFactoryLabel",
  "factoryRoute.auditGuardsLabel",
  "factoryRoute.factorySettings",
] as const;

function readKey(source: Record<string, any>, key: string) {
  return key.split(".").reduce<any>((value, part) => value?.[part], source);
}

describe("Factory i18n catalog", () => {
  it("keeps the Factory route keys aligned across shipped locales", async () => {
    for (const [locale, messages] of Object.entries(localeMessages)) {
      for (const key of requiredKeys) {
        expect(
          readKey(messages, key),
          `${locale} missing ${key}`,
        ).toBeDefined();
      }
    }

    await expect(i18nCatalog.loadMessages("de-DE")).resolves.toMatchObject({
      factoryRoute: {
        rulesTitle: expect.any(String),
        auditGuardsLabel: expect.any(String),
      },
    });
  });
});
