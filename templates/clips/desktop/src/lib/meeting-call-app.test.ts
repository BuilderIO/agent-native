import { describe, expect, it } from "vitest";

import { callAppBundleIdsForJoinUrl } from "./meeting-call-app";

describe("callAppBundleIdsForJoinUrl", () => {
  it("watches browser microphone activity for Google Meet", () => {
    expect(
      callAppBundleIdsForJoinUrl("https://meet.google.com/abc-defg-hij"),
    ).toContain("com.google.Chrome");
  });

  it("watches browser microphone activity for Webex", () => {
    expect(
      callAppBundleIdsForJoinUrl("https://customer.webex.com/meet/abc"),
    ).toContain("com.google.Chrome");
  });

  it("watches both native and browser bundles for Zoom", () => {
    for (const url of [
      "https://zoom.us/j/123",
      "https://us02web.zoom.com/j/123",
      "https://gov.zoomgov.com/j/123",
    ]) {
      const ids = callAppBundleIdsForJoinUrl(url);
      expect(ids).toContain("us.zoom.xos");
      expect(ids).toContain("com.google.Chrome");
    }
  });

  it("watches native and browser microphone activity for Teams Live", () => {
    const ids = callAppBundleIdsForJoinUrl("https://teams.live.com/meet/123");

    expect(ids).toContain("com.microsoft.teams2");
    expect(ids).toContain("com.google.Chrome");
  });

  it("keeps native Zoom and Teams as the default", () => {
    expect(callAppBundleIdsForJoinUrl(undefined)).toEqual([
      "us.zoom.xos",
      "us.zoom.ZoomClips",
      "com.microsoft.teams2",
      "com.microsoft.teams",
    ]);
  });

  it("uses the exact browser bundle set for URL-less web meetings", () => {
    const browserBundles = [
      "com.google.Chrome",
      "company.thebrowser.Browser",
      "com.apple.Safari",
      "org.mozilla.firefox",
    ];

    expect(callAppBundleIdsForJoinUrl(null, "meet")).toEqual(browserBundles);
    expect(callAppBundleIdsForJoinUrl(null, "webex")).toEqual(browserBundles);
  });

  it("prefers the browser process that confirmed an adhoc call", () => {
    expect(
      callAppBundleIdsForJoinUrl(null, "meet", "com.google.chrome"),
    ).toEqual(["com.google.Chrome"]);
    expect(
      callAppBundleIdsForJoinUrl(
        "https://teams.microsoft.com/meet/123",
        "teams",
        "company.thebrowser.browser",
      ),
    ).toEqual(["company.thebrowser.Browser"]);
  });

  it("uses native and browser bundles for URL-less Zoom and Teams", () => {
    const nativeAndBrowserBundles = [
      "us.zoom.xos",
      "us.zoom.ZoomClips",
      "com.microsoft.teams2",
      "com.microsoft.teams",
      "com.google.Chrome",
      "company.thebrowser.Browser",
      "com.apple.Safari",
      "org.mozilla.firefox",
    ];

    expect(callAppBundleIdsForJoinUrl(null, "zoom")).toEqual(
      nativeAndBrowserBundles,
    );
    expect(callAppBundleIdsForJoinUrl(null, "teams")).toEqual(
      nativeAndBrowserBundles,
    );
  });

  it("does not treat an arbitrary browser URL as a meeting call", () => {
    expect(callAppBundleIdsForJoinUrl("https://example.com")).not.toContain(
      "com.google.Chrome",
    );
  });

  it("parses meeting URLs when URL.canParse is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(URL, "canParse");
    Object.defineProperty(URL, "canParse", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(
        callAppBundleIdsForJoinUrl("https://meet.google.com/abc-defg-hij"),
      ).toContain("com.google.Chrome");
      expect(callAppBundleIdsForJoinUrl("not a URL", "meet")).toContain(
        "com.google.Chrome",
      );
    } finally {
      if (descriptor) Object.defineProperty(URL, "canParse", descriptor);
      else Reflect.deleteProperty(URL, "canParse");
    }
  });
});
