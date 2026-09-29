import { describe, expect, it } from "vitest";

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

const catalogs = {
  "ar-SA": arSA,
  "de-DE": deDE,
  "en-US": enUS,
  "es-ES": esES,
  "fr-FR": frFR,
  "hi-IN": hiIN,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "pt-BR": ptBR,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

describe("provider-neutral scheduled-send recovery copy", () => {
  it.each(Object.entries(catalogs))(
    "%s points to Mail's Sent view without assuming Gmail",
    (_locale, catalog) => {
      expect(catalog.mail.sendLater.deliveryUnknownWarning).toMatch(/mail/i);
      expect(catalog.mail.sendLater.deliveryUnknownWarning).not.toMatch(
        /gmail/i,
      );
      expect(catalog.mail.sendLater.confirmSendNewCopyDescription).toMatch(
        /mail/i,
      );
      expect(catalog.mail.sendLater.confirmSendNewCopyDescription).not.toMatch(
        /gmail/i,
      );
    },
  );
});
