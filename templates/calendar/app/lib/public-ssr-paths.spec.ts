import { describe, expect, it } from "vitest";

function isPublicBookingPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (
    /^\/book\/[^/]+(?:\/[^/]+)?$/.test(p) ||
    /^\/meet\/[^/]+\/[^/]+$/.test(p) ||
    /^\/booking\/manage\/[^/]+$/.test(p)
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

  it("does not SSR a /meet/:username path without a booking slug", () => {
    expect(isPublicBookingPath("/meet/steve")).toBe(false);
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
    expect(isPublicBookingPath("/booking-links")).toBe(false);
  });
});
