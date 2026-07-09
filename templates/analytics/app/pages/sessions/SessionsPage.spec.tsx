import { describe, expect, it } from "vitest";

import { formatSessionDuration, sessionDeviceLabel } from "./SessionsPage";

describe("formatSessionDuration", () => {
  it("shows whole-minute labels for session playlist rows", () => {
    expect(formatSessionDuration(13 * 60_000 + 32_000)).toBe("13m");
    expect(formatSessionDuration(2 * 60_000 + 54_000)).toBe("2m");
    expect(formatSessionDuration(52 * 60_000 + 24_000)).toBe("52m");
  });

  it("keeps hour-long labels in hours and minutes", () => {
    expect(formatSessionDuration(2 * 60 * 60_000 + 23 * 60_000)).toBe("2h 23m");
  });

  it("uses minutes for empty or sub-minute durations", () => {
    expect(formatSessionDuration(null)).toBe("0m");
    expect(formatSessionDuration(0)).toBe("0m");
    expect(formatSessionDuration(42_000)).toBe("0m");
  });
});

describe("sessionDeviceLabel", () => {
  it("uses explicit OS metadata when present", () => {
    expect(
      sessionDeviceLabel({
        metadata: { os: { name: "macOS", version: "15.5" } },
      }),
    ).toBe("macOS 15.5");
  });

  it("falls back to user-agent inference", () => {
    expect(
      sessionDeviceLabel({
        metadata: {
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }),
    ).toBe("Windows");
  });

  it("returns null when no OS signal is available", () => {
    expect(sessionDeviceLabel({ metadata: {} })).toBeNull();
  });
});
