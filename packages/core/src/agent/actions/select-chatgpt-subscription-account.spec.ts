import { expect, it } from "vitest";

import selectChatgptSubscriptionAccount from "./select-chatgpt-subscription-account.js";

it("refuses full-app panels", () => {
  expect(selectChatgptSubscriptionAccount.requiresSignedInBrowser).toBe(true);
});
