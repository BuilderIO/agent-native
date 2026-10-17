import { describe, expect, it } from "vitest";

import { i18nCatalog } from "./i18n";

describe("Calendar locale catalog", () => {
  it("loads each translated catalog through its locale loader", async () => {
    const locales = [
      "zh-CN",
      "zh-TW",
      "es-ES",
      "fr-FR",
      "de-DE",
      "ja-JP",
      "ko-KR",
      "pt-BR",
      "hi-IN",
      "ar-SA",
    ] as const;

    for (const locale of locales) {
      const messages = await i18nCatalog.loadMessages(locale);
      expect(messages, locale).not.toBeNull();
      expect(Object.keys(messages ?? {}), locale).not.toHaveLength(0);
    }
  });
});
