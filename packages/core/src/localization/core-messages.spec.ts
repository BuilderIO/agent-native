import { describe, expect, it } from "vitest";

import {
  coreMessagesForLocale,
  loadCoreMessagesForLocale,
} from "./core-messages.js";
import { ENVIRONMENT_BADGE_MESSAGES } from "./environment-badge-messages.js";
import { iconPickerMessagesForLocale } from "./icon-picker-messages.js";
import { MCP_SETTINGS_MESSAGES } from "./mcp-settings-messages.js";
import { PRIVACY_SETTINGS_MESSAGES } from "./privacy-settings-messages.js";
import { SUPPORTED_LOCALES } from "./shared.js";

function placeholders(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1]!)
    .sort();
}

describe("Core localization", () => {
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

  it("loads each locale's settings copy from its own catalog", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadCoreMessagesForLocale(locale);
      expect(messages.settings, locale).toEqual({
        ...MCP_SETTINGS_MESSAGES[locale],
        ...PRIVACY_SETTINGS_MESSAGES[locale],
      });
    }
  });

  it("loads each locale's icon picker copy from its own catalog", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadCoreMessagesForLocale(locale);
      expect(messages.iconPicker, locale).toEqual(
        iconPickerMessagesForLocale(locale),
      );
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
});
