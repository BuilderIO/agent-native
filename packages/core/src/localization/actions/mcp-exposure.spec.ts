import { describe, expect, it } from "vitest";

import getLocalizationPreference from "./get-localization-preference.js";
import setLocalizationPreference from "./set-localization-preference.js";

describe("localization actions over MCP", () => {
  it.each([
    ["get-localization-preference", getLocalizationPreference],
    ["set-localization-preference", setLocalizationPreference],
  ] as const)("keeps %s in the app, off MCP", (_name, action) => {
    expect(action.mcpTool).toBe(false);
  });
});
