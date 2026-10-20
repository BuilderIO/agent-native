import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const localeFiles = [
  "ar-SA",
  "de-DE",
  "en-US",
  "es-ES",
  "fr-FR",
  "hi-IN",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "zh-CN",
  "zh-TW",
];

function stringValue(source: string, key: string): string | undefined {
  return new RegExp(`\\b${key}:\\s*("[^"]*")`).exec(source)?.[1];
}

describe("AI spam labels", () => {
  it("uses the same short label in setup and triage settings in every locale", () => {
    for (const locale of localeFiles) {
      const source = readFileSync(
        new URL(`../i18n/${locale}.ts`, import.meta.url),
        "utf8",
      );

      expect(stringValue(source, "aiSetupSpamLabel"), locale).toBe(
        stringValue(source, "spamMode"),
      );
    }
  });
});
