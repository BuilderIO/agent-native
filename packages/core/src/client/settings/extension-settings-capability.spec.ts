// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { areExtensionSettingsEnabled } from "./SettingsPanel.js";

describe("areExtensionSettingsEnabled", () => {
  it("keeps extension management out of Settings by default", () => {
    expect(areExtensionSettingsEnabled()).toBe(false);
    expect(areExtensionSettingsEnabled({ extensionTools: false })).toBe(false);
  });

  it("allows hosts to opt into extension management", () => {
    expect(areExtensionSettingsEnabled({ extensionTools: true })).toBe(true);
  });
});
