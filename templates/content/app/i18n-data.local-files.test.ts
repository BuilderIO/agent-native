import { describe, expect, it } from "vitest";

// Locale data registers into messagesByLocale when each lazy module loads;
// importing every locale module here mirrors the built app's registry.
import "./i18n/ar-SA";
import "./i18n/de-DE";
import "./i18n/es-ES";
import "./i18n/fr-FR";
import "./i18n/hi-IN";
import "./i18n/ja-JP";
import "./i18n/ko-KR";
import "./i18n/pt-BR";
import "./i18n/zh-CN";
import "./i18n/zh-TW";
import { messagesByLocale } from "./i18n-data";

describe("local folder host guidance", () => {
  it("directs every unsupported host to Agent-Native Desktop", () => {
    for (const messages of Object.values(messagesByLocale)) {
      expect(messages.localFiles.unsupportedElectron).toContain(
        "Agent-Native Desktop",
      );
      expect(messages.localFiles.unsupportedBrowser).toContain(
        "Agent-Native Desktop",
      );
      expect(messages.localFiles.interruptedPicker).toContain(
        "Agent-Native Desktop",
      );
    }
  });

  it("names the supported Chromium browser path", () => {
    expect(messagesByLocale["en-US"].localFiles.unsupportedElectron).toBe(
      "Local folder sync is unavailable here. Use Agent-Native Desktop, Chrome, Edge, or another Chromium browser.",
    );
    expect(messagesByLocale["en-US"].localFiles.unsupportedBrowser).toBe(
      messagesByLocale["en-US"].localFiles.unsupportedElectron,
    );
  });
});
