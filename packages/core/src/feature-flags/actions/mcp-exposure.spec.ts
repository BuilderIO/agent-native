import { describe, expect, it } from "vitest";

import listFeatureFlags from "./list-feature-flags.js";

describe("feature flags actions over MCP", () => {
  it.each([["list-feature-flags", listFeatureFlags]] as const)(
    "keeps %s in the app, off MCP",
    (_name, action) => {
      expect(action.mcpTool).toBe(false);
    },
  );
});
