import { describe, expect, it } from "vitest";

import {
  SAVE_CONFLICT_MESSAGES,
  saveConflictMessagesForLocale,
} from "./save-conflict-messages.js";
import { SUPPORTED_LOCALES } from "./shared.js";

const PLACEHOLDER = /\{\{[a-zA-Z]+\}\}/g;

describe("save conflict translations", () => {
  it("translates every message in every built-in locale, with the same placeholders", () => {
    const english = SAVE_CONFLICT_MESSAGES["en-US"];
    for (const locale of SUPPORTED_LOCALES) {
      const messages = SAVE_CONFLICT_MESSAGES[locale];
      for (const key of Object.keys(english) as (keyof typeof english)[]) {
        expect(messages[key], `${locale} ${key}`).toEqual(expect.any(String));
        expect(messages[key].trim(), `${locale} ${key}`).not.toBe("");
        expect(
          (messages[key].match(PLACEHOLDER) ?? []).sort(),
          `${locale} ${key}`,
        ).toEqual((english[key].match(PLACEHOLDER) ?? []).sort());
        // A one-word label can be the same word in another language.
        if (locale !== "en-US" && english[key].includes(" ")) {
          expect(messages[key], `${locale} ${key}`).not.toBe(english[key]);
        }
      }
    }
  });

  it("names the changed fields in the message that lists them", () => {
    expect(SAVE_CONFLICT_MESSAGES["en-US"].changedByBoth).toContain(
      "{{fields}}",
    );
  });

  it("returns the locale's own copy", () => {
    expect(saveConflictMessagesForLocale("fr-FR")).toBe(
      SAVE_CONFLICT_MESSAGES["fr-FR"],
    );
  });

  it("falls back to English for a locale without its own copy", () => {
    expect(saveConflictMessagesForLocale("xx-XX" as never)).toBe(
      SAVE_CONFLICT_MESSAGES["en-US"],
    );
  });
});
