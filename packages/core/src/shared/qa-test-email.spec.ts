import { describe, expect, it } from "vitest";

import { isQaTestEmail } from "./qa-test-email.js";

describe("isQaTestEmail", () => {
  it("matches the synthetic identities found leaking into production analytics", () => {
    for (const email of [
      "steve+qa-test-bot-9f2@builder.io",
      "qa-test-bot-9f2@agent-native.com",
      "an-e2e-probe-4471@e2e.agent-native.test",
      "e2e-4471@example.com",
      "beta-sweep@anything.invalid",
    ]) {
      expect(isQaTestEmail(email), email).toBe(true);
    }
  });

  it("leaves real signups alone, including ones that merely look synthetic", () => {
    for (const email of [
      "steve@builder.io",
      "test@gmail.com",
      "qa@acme.co",
      "demo@startup.io",
      "e2e@realcompany.com",
      "someone@example.company.com",
      "user@testing.com",
      "cron@example.com",
      "someone+tag@example.com",
    ]) {
      expect(isQaTestEmail(email), email).toBe(false);
    }
  });

  it("ignores non-strings and blanks", () => {
    for (const value of [undefined, null, 42, {}, "", "   "]) {
      expect(isQaTestEmail(value)).toBe(false);
    }
  });
});
