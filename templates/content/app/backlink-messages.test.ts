import { describe, expect, it } from "vitest";

import { backlinkMessagesByLocale } from "./backlink-messages";

describe("backlink messages", () => {
  const pluralKeys = ["linkedFrom", "linkedFromMore", "showMore"] as const;

  it("keeps every configured locale structurally complete", () => {
    const baseKeys = (messages: Record<string, string>) =>
      Object.keys(messages)
        .map((key) => key.replace(/_(zero|one|two|few|many|other)$/, ""))
        .filter((key, index, keys) => keys.indexOf(key) === index)
        .sort();

    const sourceKeys = baseKeys(backlinkMessagesByLocale["en-US"]);
    for (const messages of Object.values(backlinkMessagesByLocale)) {
      expect(baseKeys(messages)).toEqual(sourceKeys);
    }
  });

  it("uses locale-specific plural keys with stable count placeholders", () => {
    for (const [locale, localeMessages] of Object.entries(
      backlinkMessagesByLocale,
    )) {
      const messages: Record<string, string | undefined> = localeMessages;
      const categories = new Intl.PluralRules(locale).resolvedOptions()
        .pluralCategories;
      for (const key of pluralKeys) {
        expect(messages[key]).toBeUndefined();
        for (const category of categories) {
          expect(messages[`${key}_${category}`]).toContain("{{count}}");
        }
      }
    }
  });
});
