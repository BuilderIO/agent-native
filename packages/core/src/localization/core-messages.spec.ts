import { describe, expect, it } from "vitest";

import { localizeKnownChatErrorText } from "../client/error-format.js";
import {
  coreMessagesForLocale,
  englishAgentChatMessages,
  loadAgentChatMessagesForLocale,
  loadCoreMessagesForLocale,
} from "./core-messages.js";
import defaultEnglishMessages from "./default-messages.js";
import { ENVIRONMENT_BADGE_MESSAGES } from "./environment-badge-messages.js";
import { MCP_SETTINGS_MESSAGES } from "./mcp-settings-messages.js";
import { PRIVACY_SETTINGS_MESSAGES } from "./privacy-settings-messages.js";
import { SUPPORTED_LOCALES } from "./shared.js";

function placeholders(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1]!)
    .sort();
}

describe("built-in Core chat translations", () => {
  it("localizes environment badge copy in every built-in locale", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadCoreMessagesForLocale(locale);
      expect(messages.environmentBadge, locale).toEqual(
        ENVIRONMENT_BADGE_MESSAGES[locale],
      );
    }
  });

  it("loads each locale's settings copy from its own catalog", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadCoreMessagesForLocale(locale);
      expect(messages.settings, locale).toEqual({
        ...MCP_SETTINGS_MESSAGES[locale],
        ...PRIVACY_SETTINGS_MESSAGES[locale],
      });
    }
  });

  it("keeps localized environment badges in synchronous boot messages", () => {
    expect(coreMessagesForLocale("es-ES")).toEqual({
      environmentBadge: ENVIRONMENT_BADGE_MESSAGES["es-ES"],
    });
    expect(coreMessagesForLocale("es-ES")).not.toHaveProperty("settings");
    expect(coreMessagesForLocale("en-US").environmentBadge).toEqual(
      ENVIRONMENT_BADGE_MESSAGES["en-US"],
    );
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
      mcpIntegrations: {
        customTitle: "Eigene Agent-Integration hinzufügen",
        status: { verified: "Verifiziert" },
      },
    });
  });

  it("keeps English mcpIntegrations chat keys identical to the default catalog", () => {
    const drifted = Object.entries(englishAgentChatMessages).filter(
      ([key, value]) => {
        if (!key.startsWith("mcpIntegrations.")) return false;
        let fallback: unknown = defaultEnglishMessages;
        for (const part of key.split(".")) {
          fallback = (fallback as Record<string, unknown> | undefined)?.[part];
        }
        return fallback !== value;
      },
    );
    expect(drifted).toEqual([]);
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
