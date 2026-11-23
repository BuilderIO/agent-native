import { expect, it } from "vitest";

import selectChatgptSubscriptionAccount from "./select-chatgpt-subscription-account.js";

it("refuses full-app panels", () => {
  expect(selectChatgptSubscriptionAccount.requiresSignedInBrowser).toBe(true);
});

it("keeps select-chatgpt-subscription-account in the app, off MCP", async () => {
  const { default: action } =
    await import("./select-chatgpt-subscription-account.js");
  expect(action.mcpTool).toBe(false);
});
