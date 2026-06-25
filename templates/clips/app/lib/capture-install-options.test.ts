import { describe, expect, it } from "vitest";

import {
  resolveClipsChromeExtensionEnabled,
  supportsPublishedClipsChromeExtensionHost,
} from "./capture-install-options";

describe("capture install options", () => {
  it("enables the published Chrome extension on supported first-party/local hosts", () => {
    expect(
      supportsPublishedClipsChromeExtensionHost("clips.agent-native.com"),
    ).toBe(true);
    expect(supportsPublishedClipsChromeExtensionHost("localhost")).toBe(true);
    expect(supportsPublishedClipsChromeExtensionHost("127.0.0.1")).toBe(true);
  });

  it("does not enable the published Chrome extension by default on unsupported hosts", () => {
    expect(resolveClipsChromeExtensionEnabled({})).toBe(false);
    expect(
      resolveClipsChromeExtensionEnabled({
        hostname: "my-clips.example.com",
      }),
    ).toBe(false);
  });

  it("allows explicit env overrides for custom extension deployments", () => {
    expect(
      resolveClipsChromeExtensionEnabled({
        enabledSetting: "1",
        hostname: "my-clips.example.com",
      }),
    ).toBe(true);
    expect(
      resolveClipsChromeExtensionEnabled({
        enabledSetting: "off",
        hostname: "clips.agent-native.com",
      }),
    ).toBe(false);
  });
});
