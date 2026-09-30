import { describe, expect, it } from "vitest";

import { BILLING_NOTICE_MESSAGES } from "./billing-notice-messages.js";
import { SUPPORTED_LOCALES } from "./shared.js";

describe("billing notice translations", () => {
  it("keeps the server email copy localized in every built-in locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = BILLING_NOTICE_MESSAGES[locale];
      expect(messages.builderCreditLimitTitle, locale).toEqual(
        expect.any(String),
      );
      expect(messages.builderCreditLimitEmailBody, locale).toEqual(
        expect.any(String),
      );
      expect(messages.builderCreditUpgrade, locale).toEqual(expect.any(String));
    }
  });
});
