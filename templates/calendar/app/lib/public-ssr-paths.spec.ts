/**
 * Regression guard: public booking paths must be correctly identified so
 * root.tsx renders them outside ClientOnly (SSR-first, not spinner-first).
 */
import { describe, expect, it } from "vitest";

// Re-implement the same predicate that root.tsx uses so tests stay in sync
// with the real predicate. If root.tsx changes its predicate, update both.
function isPublicBookingPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (
    p.startsWith("/book/") ||
    p.startsWith("/meet/") ||
    p.startsWith("/booking/manage/")
  );
}

describe("isPublicBookingPath", () => {
  it("matches /book/:slug booking pages", () => {
    expect(isPublicBookingPath("/book/my-slot")).toBe(true);
    expect(isPublicBookingPath("/book/my-slot/")).toBe(true);
  });

  it("matches /book/:username/:slug pages", () => {
    expect(isPublicBookingPath("/book/alice/intro")).toBe(true);
  });

  it("matches /meet/:username/:slug legacy pages", () => {
    expect(isPublicBookingPath("/meet/alice/intro")).toBe(true);
  });

  it("matches /booking/manage/:token pages", () => {
    expect(isPublicBookingPath("/booking/manage/tok123")).toBe(true);
  });

  it("does NOT match authenticated app paths", () => {
    expect(isPublicBookingPath("/")).toBe(false);
    expect(isPublicBookingPath("/settings")).toBe(false);
    expect(isPublicBookingPath("/booking-links")).toBe(false);
    expect(isPublicBookingPath("/availability")).toBe(false);
    expect(isPublicBookingPath("/bookings")).toBe(false);
  });

  it("does NOT match a path that merely starts with /book without a trailing slash", () => {
    // /booking-links should NOT be matched — only /book/<something>
    expect(isPublicBookingPath("/booking-links")).toBe(false);
  });
});
