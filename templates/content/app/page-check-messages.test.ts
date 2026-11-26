import { describe, expect, it } from "vitest";

import { pageCheckMessagesByLocale } from "./page-check-messages";

describe("check messages", () => {
  const pluralKeys = [
    "lookAt",
    "words",
    "sentences",
    "paragraphs",
    "skippedCount",
  ] as const;

  it("keeps every configured locale structurally complete", () => {
    const baseKeys = (messages: Record<string, string>) =>
      Object.keys(messages)
        .map((key) => key.replace(/_(zero|one|two|few|many|other)$/, ""))
        .filter((key, index, keys) => keys.indexOf(key) === index)
        .sort();

    const sourceKeys = baseKeys(pageCheckMessagesByLocale["en-US"]);
    for (const messages of Object.values(pageCheckMessagesByLocale)) {
      expect(baseKeys(messages)).toEqual(sourceKeys);
    }
  });

  it("uses locale-specific plural keys with stable count placeholders", () => {
    for (const [locale, localeMessages] of Object.entries(
      pageCheckMessagesByLocale,
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

      expect(messages.scopeSection).toContain("{{heading}}");
      expect(messages.over).toContain("{{count}}");
      expect(messages.short).toContain("{{count}}");
      expect(messages.countAndDistance).toContain("{{count}}");
      expect(messages.countAndDistance).toContain("{{distance}}");
      expect(messages.ofTotal).toContain("{{missing}}");
      expect(messages.ofTotal).toContain("{{total}}");
      expect(messages.markLabel).toContain("{{answer}}");
      expect(messages.markLabel).toContain("{{check}}");
      expect(messages.markLabel).toContain("{{place}}");
      expect(messages.commentText).toContain("{{check}}");
      expect(messages.commentText).toContain("{{answer}}");
      expect(messages.tabWithCount).toContain("{{tab}}");
      expect(messages.tabWithCount).toContain("{{lookAt}}");
    }
  });
});
