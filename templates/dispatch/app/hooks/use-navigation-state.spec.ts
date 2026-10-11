import { describe, expect, it } from "vitest";

import { buildDispatchNavigationState } from "./use-navigation-state.js";

describe("buildDispatchNavigationState", () => {
  it("keeps Admin integrations as the integrations view", () => {
    expect(buildDispatchNavigationState("/admin/integrations")).toEqual({
      view: "integrations",
      path: "/admin/integrations",
    });
    expect(
      buildDispatchNavigationState("/admin/integrations/provider-settings"),
    ).toEqual({
      view: "integrations",
      path: "/admin/integrations/provider-settings",
    });
  });
});
