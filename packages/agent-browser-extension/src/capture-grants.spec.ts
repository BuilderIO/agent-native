import { describe, expect, it } from "vitest";

import {
  captureGrantKey,
  captureOrigin,
  captureOriginPattern,
  isCaptureGrantValid,
} from "./capture-grants";

describe("activeTab capture grants", () => {
  it("binds the toolbar gesture to one tab and exact origin", () => {
    const grant = {
      tabId: 42,
      origin: "https://example.com",
      grantedAt: 1_785_345_600_000,
    };
    expect(captureGrantKey(42)).toBe("agentNativeCaptureGrant:42");
    expect(isCaptureGrantValid(grant, 42, "https://example.com/next")).toBe(
      true,
    );
    expect(isCaptureGrantValid(grant, 42, "https://other.example/")).toBe(
      false,
    );
    expect(isCaptureGrantValid(grant, 7, "https://example.com/")).toBe(false);
    expect(captureOriginPattern("https://example.com/path")).toBe(
      "https://example.com/*",
    );
  });

  it("rejects restricted and unreadable URLs", () => {
    expect(captureOrigin("chrome://extensions")).toBeNull();
    expect(captureOrigin("file:///tmp/example")).toBeNull();
    expect(captureOrigin("not a URL")).toBeNull();
    expect(captureOriginPattern("chrome://extensions")).toBeNull();
  });
});
