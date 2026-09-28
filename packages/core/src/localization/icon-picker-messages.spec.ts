import { describe, expect, it } from "vitest";

import { loadCoreMessagesForLocale } from "./core-messages.js";
import { ICON_PICKER_MESSAGES } from "./icon-picker-messages.js";

describe("icon picker translations", () => {
  it.each(Object.entries(ICON_PICKER_MESSAGES))(
    "provides colors, categories, and recovery text in %s",
    async (locale, messages) => {
      expect(Object.keys(messages.categoryNames)).toEqual(
        Object.keys(ICON_PICKER_MESSAGES["en-US"].categoryNames),
      );
      expect(Object.keys(messages.categoryNames)).toHaveLength(49);
      expect(Object.keys(messages.colorNames)).toHaveLength(9);
      expect(Object.keys(messages.groupNames)).toEqual(
        Object.keys(ICON_PICKER_MESSAGES["en-US"].groupNames),
      );
      expect(Object.keys(messages.groupNames)).toHaveLength(7);
      expect((await loadCoreMessagesForLocale(locale)).iconPicker).toEqual(
        messages,
      );
      for (const value of [
        messages.allCategories,
        messages.loadError,
        messages.saveError,
        messages.uploadTooLarge,
        messages.retry,
        messages.uploadHint,
        ...Object.values(messages.categoryNames),
        ...Object.values(messages.groupNames),
        ...Object.values(messages.colorNames),
      ]) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    },
  );
});
