import { describe, expect, it } from "vitest";

import { isContentSettingsRoute } from "./settings-route-policy";

describe("Content settings route policy", () => {
  it("gives Settings the full width", () => {
    expect(isContentSettingsRoute("/settings")).toBe(true);
    expect(isContentSettingsRoute("/settings/notifications")).toBe(true);
  });

  it("leaves every other route alone", () => {
    expect(isContentSettingsRoute("/settingsx")).toBe(false);
    expect(isContentSettingsRoute("/page/abc")).toBe(false);
    expect(isContentSettingsRoute("/team")).toBe(false);
  });
});
