import { describe, expect, it } from "vitest";

import listApiKeys from "./list-api-keys.js";
import previewSecretRemoval from "./preview-secret-removal.js";

describe("secrets actions over MCP", () => {
  it.each([
    ["list-api-keys", listApiKeys],
    ["preview-secret-removal", previewSecretRemoval],
  ] as const)("keeps %s in the app, off MCP", (_name, action) => {
    expect(action.mcpTool).toBe(false);
  });
});
