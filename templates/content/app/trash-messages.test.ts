import { describe, expect, it } from "vitest";

import { trashMessagesByLocale } from "./trash-messages";

describe("trash messages", () => {
  const pluralKeys = [
    "deleteQuestion",
    "deleteCount",
    "running",
    "completed",
    "confirmEmpty",
    "restoredCount",
  ] as const;

  it("keeps every configured locale structurally complete", () => {
    const baseKeys = (messages: Record<string, string>) =>
      Object.keys(messages)
        .map((key) => key.replace(/_(zero|one|two|few|many|other)$/, ""))
        .filter((key, index, keys) => keys.indexOf(key) === index)
        .sort();

    const sourceKeys = baseKeys(trashMessagesByLocale["en-US"]);
    for (const messages of Object.values(trashMessagesByLocale)) {
      expect(baseKeys(messages)).toEqual(sourceKeys);
    }
  });

  it("uses locale-specific plural keys with stable count placeholders", () => {
    for (const [locale, messages] of Object.entries(trashMessagesByLocale)) {
      const categories = new Intl.PluralRules(locale).resolvedOptions()
        .pluralCategories;

      for (const key of pluralKeys) {
        expect(messages[key]).toBeUndefined();
        for (const category of categories) {
          expect(messages[`${key}_${category}`]).toContain("{{count}}");
        }
      }

      expect(messages.scopeCounts).toContain("{{eligible}}");
      expect(messages.scopeCounts).toContain("{{blocked}}");
      expect(messages.workspaceScopeCounts).toContain("{{workspace}}");
      expect(messages.workspaceScopeCounts).toContain("{{eligible}}");
      expect(messages.workspaceScopeCounts).toContain("{{blocked}}");
      expect(messages.workspaceError).toContain("{{workspace}}");
      expect(messages.workspaceError).toContain("{{error}}");
      expect(messages.partiallyCompleted).toContain("{{deleted}}");
      expect(messages.partiallyCompleted).toContain("{{blocked}}");
      expect(messages.conflicted).toContain("{{deleted}}");
      expect(messages.conflicted).toContain("{{conflicted}}");
      for (const key of [
        "cannotPurgeWorkspace",
        "startStarted",
        "startUnknown",
        "startDidNotStart",
      ])
        expect(messages[key]).toContain("{{workspace}}");
      expect(messages.startDidNotStart).toContain("{{error}}");
      expect(messages.blockedItem).toContain("{{reason}}");
      expect(messages.survivorEffect).toContain("{{effect}}");
      expect(messages.outcome).toContain("{{outcome}}");
    }
  });
});
