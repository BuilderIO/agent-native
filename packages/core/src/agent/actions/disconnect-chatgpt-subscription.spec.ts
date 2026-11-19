import { expect, it } from "vitest";

import disconnectChatgptSubscription from "./disconnect-chatgpt-subscription.js";

it("refuses full-app panels", () => {
  expect(disconnectChatgptSubscription.requiresSignedInBrowser).toBe(true);
});
