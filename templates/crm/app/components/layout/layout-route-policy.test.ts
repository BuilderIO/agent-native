import { describe, expect, it } from "vitest";

import { isCrmFullWidthSettingsRoute } from "./layout-route-policy";

const ON = { status: "ready", enabled: true };
const OFF = { status: "ready", enabled: false };
const LOADING = { status: "loading", enabled: false };
const UNAVAILABLE = { status: "unavailable", enabled: false };

describe("isCrmFullWidthSettingsRoute", () => {
  it("renders the redesigned Settings without CRM's chrome", () => {
    expect(isCrmFullWidthSettingsRoute("/settings", ON)).toBe(true);
    expect(isCrmFullWidthSettingsRoute("/settings/app/fields", ON)).toBe(true);
  });

  it("holds the full-width frame while the flag loads", () => {
    expect(isCrmFullWidthSettingsRoute("/settings/app", LOADING)).toBe(true);
  });

  it("keeps CRM's sidebar for today's Settings", () => {
    expect(isCrmFullWidthSettingsRoute("/settings/fields", OFF)).toBe(false);
    expect(isCrmFullWidthSettingsRoute("/settings", UNAVAILABLE)).toBe(false);
  });

  it("never changes other routes", () => {
    expect(isCrmFullWidthSettingsRoute("/settingsx", ON)).toBe(false);
    expect(isCrmFullWidthSettingsRoute("/lists", ON)).toBe(false);
    expect(isCrmFullWidthSettingsRoute("/setup", LOADING)).toBe(false);
  });
});
