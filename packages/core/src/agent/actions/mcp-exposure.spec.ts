import { describe, expect, it } from "vitest";

import getChatgptSubscriptionStatus from "./get-chatgpt-subscription-status.js";
import getProviderModels from "./get-provider-models.js";
import listChatgptSubscriptionAccounts from "./list-chatgpt-subscription-accounts.js";

describe("agent actions over MCP", () => {
  it.each([
    ["get-chatgpt-subscription-status", getChatgptSubscriptionStatus],
    ["get-provider-models", getProviderModels],
    ["list-chatgpt-subscription-accounts", listChatgptSubscriptionAccounts],
  ] as const)("keeps %s in the app, off MCP", (_name, action) => {
    expect(action.mcpTool).toBe(false);
  });
});
