import { describe, expect, it } from "vitest";

import { localizeKnownChatErrorText } from "../client/error-format.js";
import {
  englishAgentChatMessages,
  loadAgentChatMessagesForLocale,
  loadCoreMessagesForLocale,
} from "./core-messages.js";
import { ENVIRONMENT_BADGE_MESSAGES } from "./environment-badge-messages.js";
import { PRIVACY_SETTINGS_MESSAGES } from "./privacy-settings-messages.js";
import { SUPPORTED_LOCALES } from "./shared.js";

function placeholders(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1]!)
    .sort();
}

describe("built-in Core chat translations", () => {
  it("localizes resource pack labels in every built-in locale", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadCoreMessagesForLocale(locale);
      const pack = messages.agentResources as Record<string, string>;
      expect(pack.exportPack, locale).toEqual(expect.any(String));
      expect(pack.importPack, locale).toEqual(expect.any(String));
      expect(pack.exportPackSuccess, locale).toEqual(expect.any(String));
      expect(pack.exportPackFailed, locale).toEqual(expect.any(String));
      expect(pack.importPackFailed, locale).toEqual(expect.any(String));
      expect(pack.importPackInvalid, locale).toEqual(expect.any(String));
      expect(placeholders(pack.importPackSuccess), locale).toEqual([
        "imported",
        "skipped",
      ]);
      if (locale !== "en-US") {
        expect(pack.exportPack, locale).not.toBe("Export pack");
        expect(pack.importPackInvalid, locale).not.toBe(
          "That file is not a valid resource pack",
        );
      }
    }
  });

  it("localizes environment badge copy in every built-in locale", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadCoreMessagesForLocale(locale);
      expect(messages.environmentBadge, locale).toEqual(
        ENVIRONMENT_BADGE_MESSAGES[locale],
      );
    }
  });

  it("localizes privacy settings copy in every built-in locale", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadCoreMessagesForLocale(locale);
      expect(messages.settings, locale).toMatchObject(
        PRIVACY_SETTINGS_MESSAGES[locale],
      );
    }
  });

  it("defines every English key with matching placeholders in every locale", async () => {
    const englishKeys = Object.keys(englishAgentChatMessages)
      .filter((key) => !/_(zero|one|two|few|many|other)$/.test(key))
      .sort();

    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadAgentChatMessagesForLocale(locale);

      for (const key of englishKeys) {
        expect(messages[key], `${locale}:${key}`).toEqual(expect.any(String));
        expect(placeholders(messages[key]!), `${locale}:${key}`).toEqual(
          placeholders(englishAgentChatMessages[key]!),
        );
      }
    }
  });

  it("does not silently ship the English Core chat catalog for other locales", async () => {
    const englishEntries = Object.entries(englishAgentChatMessages).filter(
      ([key]) => !/_(zero|one|two|few|many|other)$/.test(key),
    );

    for (const locale of SUPPORTED_LOCALES.filter(
      (candidate) => candidate !== "en-US",
    )) {
      const messages = await loadAgentChatMessagesForLocale(locale);
      const translatedEntries = englishEntries.filter(
        ([key, value]) => messages[key] !== value,
      );
      expect(
        translatedEntries.length / englishEntries.length,
        locale,
      ).toBeGreaterThan(0.9);
    }
  });

  it("keeps previously published chat catalog keys localized", async () => {
    const messages = await loadCoreMessagesForLocale("de-DE");

    expect(messages).toMatchObject({
      agentPanel: {
        addOwnKeys: "Eigene Schlüssel",
        chat: "Chat",
        loadingTerminal: "Terminal wird geladen...",
        newChat: "Neuer Chat",
        toggleAgent: "Agent ein-/ausblenden",
        voiceMode: {
          entryButtonLabel: "Mikrofon verwenden",
        },
      },
      contextXray: {
        panelTitle: "Kontext-Röntgen",
      },
    });
  });

  it.each([
    [
      "de-DE",
      "Es ist kein LLM-Anbieter verbunden. Öffne Einstellungen > Agent > KI-Anbieter und verbinde anschließend Builder.io (kostenloser Tarif verfügbar) oder füge einen Anbieterschlüssel hinzu.",
    ],
    [
      "ar-SA",
      "لا يوجد مزوّد LLM متصل. افتح الإعدادات > الوكيل > مزوّدو الذكاء الاصطناعي، ثم اربط Builder.io (تتوفر خطة مجانية) أو أضف مفتاح مزوّد.",
    ],
  ])(
    "localizes Core's missing-provider error for %s",
    async (locale, expected) => {
      const messages = await loadAgentChatMessagesForLocale(locale);
      const t = (key: string, options?: Record<string, unknown>) =>
        messages[key.replace(/^agentChat\./, "")] ??
        String(options?.defaultValue ?? key);

      expect(
        localizeKnownChatErrorText(
          "No LLM provider is connected. Open this app's Manage agent > LLM, then connect Builder.io or add a provider key.",
          t,
        ),
      ).toBe(expected);
    },
  );
});
