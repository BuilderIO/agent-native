import { describe, expect, it } from "vitest";

import { isCrmSettingsRoute } from "./layout-route-policy";

describe("isCrmSettingsRoute", () => {
  it("renders Settings without CRM's chrome", () => {
    expect(isCrmSettingsRoute("/settings")).toBe(true);
    expect(isCrmSettingsRoute("/settings/app/fields")).toBe(true);
  });

  it("never changes other routes", () => {
    expect(isCrmSettingsRoute("/settingsx")).toBe(false);
    expect(isCrmSettingsRoute("/lists")).toBe(false);
    expect(isCrmSettingsRoute("/setup")).toBe(false);
  });
});
