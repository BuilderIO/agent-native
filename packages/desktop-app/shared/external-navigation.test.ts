import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canOpenDesktopExternalUrl,
  isAllowedMacPrivacySettingsUrl,
} from "./external-navigation";

describe("desktop external navigation", () => {
  for (const url of [
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  ]) {
    it(`allows the supported macOS privacy pane URL ${url}`, () => {
      assert.equal(isAllowedMacPrivacySettingsUrl(url), true);
      assert.equal(canOpenDesktopExternalUrl(url, "darwin"), true);
    });
  }

  for (const url of [
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
    "x-apple.systempreferences://com.apple.preference.security?Privacy_Camera",
    "file:///Applications/Utilities",
    "javascript:alert(1)",
  ]) {
    it(`rejects unsupported native URL ${url}`, () => {
      assert.equal(isAllowedMacPrivacySettingsUrl(url), false);
      assert.equal(canOpenDesktopExternalUrl(url, "darwin"), false);
    });
  }

  it("does not allow macOS settings URLs on other platforms", () => {
    assert.equal(
      canOpenDesktopExternalUrl(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "win32",
      ),
      false,
    );
  });

  for (const url of [
    "https://agent-native.com",
    "mailto:test@example.com",
    "tel:+1",
  ]) {
    it(`preserves supported external URL ${url}`, () => {
      assert.equal(canOpenDesktopExternalUrl(url, "darwin"), true);
    });
  }
});
