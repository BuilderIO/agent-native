import { describe, expect, it } from "vitest";

import { BROWSER_TAB_QUERY_PARAM } from "./browser-tab-url.js";

describe("browser tab URL", () => {
  // A link carries this name in its URL and outlives the deploy that made it,
  // so renaming it would send older links' tabs nowhere.
  it("names the tab with the parameter open links already carry", () => {
    expect(BROWSER_TAB_QUERY_PARAM).toBe("agentNativeTab");
  });
});
