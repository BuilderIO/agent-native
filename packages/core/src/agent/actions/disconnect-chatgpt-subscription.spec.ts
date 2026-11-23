import { expect, it } from "vitest";

import disconnectChatgptSubscription from "./disconnect-chatgpt-subscription.js";

it("refuses full-app panels", () => {
  expect(disconnectChatgptSubscription.requiresSignedInBrowser).toBe(true);
});

it("keeps disconnect-chatgpt-subscription in the app, off MCP", async () => {
  const { default: action } =
    await import("./disconnect-chatgpt-subscription.js");
  expect(action.mcpTool).toBe(false);
});
