import { describe, expect, it } from "vitest";

import { formatRelativeTimeFromNow } from "./relative-time";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("formatRelativeTimeFromNow", () => {
  it("reports 'now' under a minute instead of '-0 minutes'", () => {
    expect(formatRelativeTimeFromNow(ago(30 * 1000), NOW)).toBe("now");
  });

  it("localizes the sub-minute case for the active locale", () => {
    expect(formatRelativeTimeFromNow(ago(30 * 1000), NOW, "es")).toBe("ahora");
  });

  it("formats minutes", () => {
    expect(formatRelativeTimeFromNow(ago(5 * 60 * 1000), NOW)).toBe(
      "5 minutes ago",
    );
  });

  it("formats hours", () => {
    expect(formatRelativeTimeFromNow(ago(3 * 60 * 60 * 1000), NOW)).toBe(
      "3 hours ago",
    );
  });

  it("formats days", () => {
    expect(formatRelativeTimeFromNow(ago(2 * 24 * 60 * 60 * 1000), NOW)).toBe(
      "2 days ago",
    );
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatRelativeTimeFromNow("not-a-date", NOW)).toBe("");
  });
});
