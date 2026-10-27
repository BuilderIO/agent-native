import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: vi.fn(),
  getSession: vi.fn(),
  readBody: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  putUserSetting: vi.fn(),
}));

vi.mock("h3", async () => {
  const actual = await vi.importActual<typeof import("h3")>("h3");
  return {
    ...actual,
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: { query: Record<string, unknown> }) => event.query,
  };
});

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return { ...actual, getDb: mocks.getDb };
});

import { schema } from "../db/index.js";
import { getPublicAvailability } from "./availability.js";

const ownerAvailability = {
  timezone: "America/Los_Angeles",
  weeklySchedule: {
    monday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    tuesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    wednesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    thursday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    friday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    saturday: { enabled: false, slots: [] },
    sunday: { enabled: false, slots: [] },
  },
  bufferMinutes: 15,
  minNoticeHours: 1,
  maxAdvanceDays: 60,
  slotDurationMinutes: 30,
  bookingPageSlug: "book",
};

describe("public booking availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: (table: unknown) => ({
          where: async () =>
            table === schema.bookingUsernames
              ? [{ ownerEmail: "owner@example.com" }]
              : [],
        }),
      }),
    });
    mocks.getUserSetting.mockResolvedValue(ownerAvailability);
  });

  it("loads the saved schedule for a username booking URL", async () => {
    const result = await (getPublicAvailability as any)({
      query: { slug: "book", username: "owner" },
    });

    expect(result).toEqual(ownerAvailability);
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "calendar-availability",
    );
  });

  it("returns not found for a stale personal booking slug", async () => {
    await expect(
      (getPublicAvailability as any)({
        query: { slug: "other", username: "owner" },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not return another link owner's schedule for a mismatched username", async () => {
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: (table: unknown) => ({
          where: async () =>
            table === schema.bookingUsernames
              ? [{ ownerEmail: "owner@example.com" }]
              : [{ ownerEmail: "other@example.com" }],
        }),
      }),
    });

    await expect(
      (getPublicAvailability as any)({
        query: { slug: "other-owner-link", username: "owner" },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.getUserSetting).not.toHaveBeenCalled();
  });

  it("returns not found for an unknown username", async () => {
    mocks.getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: async () => [] }) }),
    });

    await expect(
      (getPublicAvailability as any)({
        query: { slug: "book", username: "missing" },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.getUserSetting).not.toHaveBeenCalled();
  });

  it("keeps defaults for legacy links without a username", async () => {
    const result = await (getPublicAvailability as any)({
      query: { slug: "book" },
    });

    expect(result).toMatchObject({
      timezone: "America/New_York",
      bookingPageSlug: "book",
    });
  });
});
