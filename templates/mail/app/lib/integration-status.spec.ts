import { describe, expect, it } from "vitest";

import { mailIntegrationProviderFromAppStateKey } from "./integration-status";

describe("mailIntegrationProviderFromAppStateKey", () => {
  it.each(["apollo", "hubspot", "gong", "pylon"] as const)(
    "recognizes the %s credential state key",
    (provider) => {
      expect(mailIntegrationProviderFromAppStateKey(provider)).toBe(provider);
    },
  );

  it("recognizes wildcard changes but ignores unrelated app state", () => {
    expect(mailIntegrationProviderFromAppStateKey("*")).toBe("*");
    expect(mailIntegrationProviderFromAppStateKey("navigation")).toBeNull();
    expect(mailIntegrationProviderFromAppStateKey(undefined)).toBeNull();
  });
});
