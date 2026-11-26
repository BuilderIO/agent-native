import { expect, it } from "vitest";

import { ACTION_ERROR_MESSAGES } from "./action-error-messages.js";
import {
  coreMessagesForLocale,
  loadCoreMessagesForLocale,
} from "./core-messages.js";
import defaultMessages from "./default-messages.js";
import { SUPPORTED_LOCALES } from "./shared.js";

it("provides nonempty failure, read failure and retry copy for every supported locale", () => {
  expect(Object.keys(ACTION_ERROR_MESSAGES).sort()).toEqual(
    [...SUPPORTED_LOCALES].sort(),
  );
  for (const locale of SUPPORTED_LOCALES) {
    const messages = ACTION_ERROR_MESSAGES[locale];
    expect(Object.keys(messages).sort()).toEqual([
      "failed",
      "loadFailed",
      "retry",
    ]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/Action [\w.-]+ (failed|timed out)/);
    }
  }
});

it("wires action errors into the source catalog and every asynchronously loaded locale", async () => {
  expect(defaultMessages.actionErrors).toEqual(ACTION_ERROR_MESSAGES["en-US"]);
  expect(coreMessagesForLocale("en-US").actionErrors).toEqual(
    ACTION_ERROR_MESSAGES["en-US"],
  );
  for (const locale of SUPPORTED_LOCALES)
    expect((await loadCoreMessagesForLocale(locale)).actionErrors).toEqual(
      ACTION_ERROR_MESSAGES[locale],
    );
});
