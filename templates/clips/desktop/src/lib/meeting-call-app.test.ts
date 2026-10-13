import { describe, expect, it } from "vitest";

import { callAppBundleIdsForJoinUrl } from "./meeting-call-app";

describe("callAppBundleIdsForJoinUrl", () => {
  it("watches browser microphone activity for Google Meet", () => {
    expect(
      callAppBundleIdsForJoinUrl("https://meet.google.com/abc-defg-hij"),
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

  it("keeps native Zoom and Teams as the default", () => {
    expect(callAppBundleIdsForJoinUrl(undefined)).toEqual([
      "us.zoom.xos",
      "us.zoom.ZoomClips",
      "com.microsoft.teams2",
      "com.microsoft.teams",
    ]);
  });

  it("does not treat an arbitrary browser URL as a meeting call", () => {
    expect(callAppBundleIdsForJoinUrl("https://example.com")).not.toContain(
      "com.google.Chrome",
    );
  });
});
