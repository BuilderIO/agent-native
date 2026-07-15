import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasDismissedDesktopPromo,
  hasDownloadedDesktopApp,
  markDesktopAppDownloaded,
  markDesktopPromoDismissed,
  resolveClipsChromeExtensionEnabled,
  supportsPublishedClipsChromeExtensionHost,
} from "./capture-install-options";

describe("capture install options", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers when the desktop installer is downloaded", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    expect(hasDownloadedDesktopApp()).toBe(false);
    markDesktopAppDownloaded();
    expect(hasDownloadedDesktopApp()).toBe(true);
    // Downloading also hides the promo.
    expect(hasDismissedDesktopPromo()).toBe(true);
  });

  it("dismissing the promo does not mark the app as downloaded", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    markDesktopPromoDismissed();
    expect(hasDismissedDesktopPromo()).toBe(true);
    expect(hasDownloadedDesktopApp()).toBe(false);
  });

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
