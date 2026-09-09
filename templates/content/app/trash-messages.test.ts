import { describe, expect, it } from "vitest";

import {
  trashMessagesByLocale,
  trashRecoveryMessagesByLocale,
} from "./trash-messages";

const locales = [
  "en-US",
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

function placeholders(value: string) {
  return [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

describe("Trash locale catalogs", () => {
  it.each(locales)(
    "loads Trash translations through the configured %s catalog module",
    async (locale) => {
      const { default: catalog } = await import(`./i18n/${locale}.ts`);
      expect(catalog.trashBrowser).toEqual(
        trashMessagesByLocale[locale].trashBrowser,
      );
      expect(catalog.trashPreview).toEqual(
        trashMessagesByLocale[locale].trashPreview,
      );
      expect(catalog.trashRecovery).toEqual(
        trashRecoveryMessagesByLocale[locale],
      );
    },
  );
  it("exports exactly the eleven configured locales", () => {
    expect(Object.keys(trashMessagesByLocale).sort()).toEqual(
      [...locales].sort(),
    );
    expect(Object.keys(trashRecoveryMessagesByLocale).sort()).toEqual(
      [...locales].sort(),
    );
  });

  it.each(locales)(
    "preserves nonempty strings, keys and placeholders in %s",
    (locale) => {
      const source = {
        ...trashMessagesByLocale["en-US"],
        trashRecovery: trashRecoveryMessagesByLocale["en-US"],
      };
      const translated = {
        ...trashMessagesByLocale[locale],
        trashRecovery: trashRecoveryMessagesByLocale[locale],
      };
      for (const namespace of Object.keys(source) as (keyof typeof source)[]) {
        const expected = source[namespace] as Record<string, string>;
        const actual = translated[namespace] as Record<string, unknown>;
        const baseKey = (key: string) =>
          key.replace(/_(zero|one|two|few|many|other)$/, "");
        expect([...new Set(Object.keys(actual).map(baseKey))].sort()).toEqual(
          [...new Set(Object.keys(expected).map(baseKey))].sort(),
        );
        for (const [key, entry] of Object.entries(actual)) {
          const value = expected[key] ?? expected[baseKey(key) + "_other"];
          expect(typeof entry, `${locale}.${namespace}.${key}`).toBe("string");
          expect(
            (entry as string).trim(),
            `${locale}.${namespace}.${key}`,
          ).not.toBe("");
          expect(
            placeholders(entry as string),
            `${locale}.${namespace}.${key}`,
          ).toEqual(placeholders(value));
        }
      }
    },
  );

  it("pins the interpolation contract independently of row positions", () => {
    for (const locale of locales) {
      const { trashBrowser } = trashMessagesByLocale[locale];
      expect(placeholders(trashBrowser.select)).toEqual(["title"]);
      expect(placeholders(trashBrowser.selected)).toEqual(["count"]);
      expect(
        placeholders(trashRecoveryMessagesByLocale[locale].scope_other),
      ).toEqual(["count"]);
    }
  });
});

it.each(locales)(
  "resolves deletion and surviving-page plural categories in %s",
  (locale) => {
    const messages = trashRecoveryMessagesByLocale[locale] as Record<
      string,
      string
    >;
    for (const count of [0, 1, 2, 3, 11, 100, 1_000_000]) {
      const category = new Intl.PluralRules(locale).select(count);
      for (const key of ["scope", "detachedScope"]) {
        const message = messages[key + "_" + category];
        expect(message, locale + "." + key + "_" + category).toBeTruthy();
        expect(placeholders(message)).toEqual(["count"]);
      }
    }
  },
);
