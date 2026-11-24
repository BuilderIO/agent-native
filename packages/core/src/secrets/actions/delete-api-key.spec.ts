import { expect, it } from "vitest";

import deleteApiKey from "./delete-api-key.js";

it("refuses full-app panels", () => {
  expect(deleteApiKey.requiresSignedInBrowser).toBe(true);
});

it("keeps delete-api-key in the app, off MCP", () => {
  expect(deleteApiKey.mcpTool).toBe(false);
});
