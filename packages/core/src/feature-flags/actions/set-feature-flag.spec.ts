import { expect, it } from "vitest";

import setFeatureFlag from "./set-feature-flag.js";

it("refuses full-app panels", () => {
  expect(setFeatureFlag.requiresSignedInBrowser).toBe(true);
});

it("keeps set-feature-flag in the app, off MCP", () => {
  expect(setFeatureFlag.mcpTool).toBe(false);
});
