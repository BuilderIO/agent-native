import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "./shared.js";
import {
  WRITE_FAILURE_MESSAGES,
  writeFailureMessagesForLocale,
} from "./write-failure-messages.js";

const PLACEHOLDER = /\{\{[a-zA-Z]+\}\}/g;

describe("write failure translations", () => {
  it("translates every message in every built-in locale, with the same placeholders", () => {
    const english = WRITE_FAILURE_MESSAGES["en-US"];
    for (const locale of SUPPORTED_LOCALES) {
      const messages = WRITE_FAILURE_MESSAGES[locale];
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

  it("returns the locale's own copy", () => {
    expect(writeFailureMessagesForLocale("fr-FR")).toBe(
      WRITE_FAILURE_MESSAGES["fr-FR"],
    );
  });

  it("falls back to English for a locale without its own copy", () => {
    expect(writeFailureMessagesForLocale("xx-XX" as never)).toBe(
      WRITE_FAILURE_MESSAGES["en-US"],
    );
  });
});
