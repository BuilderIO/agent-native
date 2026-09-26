import { describe, expect, it } from "vitest";

import { isContentFullWidthSettingsRoute } from "./settings-route-policy";

describe("Content settings route policy", () => {
  it("gives Settings the full width only with the redesign on or loading", () => {
    expect(
      isContentFullWidthSettingsRoute("/settings", {
        status: "ready",
        enabled: true,
      }),
    ).toBe(true);
    expect(
      isContentFullWidthSettingsRoute("/settings/notifications", {
        status: "loading",
        enabled: false,
      }),
    ).toBe(true);
    expect(
      isContentFullWidthSettingsRoute("/settings", {
        status: "ready",
        enabled: false,
      }),
    ).toBe(false);
    expect(
      isContentFullWidthSettingsRoute("/settings", {
        status: "unavailable",
        enabled: false,
      }),
    ).toBe(false);
  });

  it("leaves every other route alone", () => {
    const on = { status: "ready", enabled: true };
    expect(isContentFullWidthSettingsRoute("/settingsx", on)).toBe(false);
    expect(isContentFullWidthSettingsRoute("/page/abc", on)).toBe(false);
    expect(isContentFullWidthSettingsRoute("/team", on)).toBe(false);
  });
});
