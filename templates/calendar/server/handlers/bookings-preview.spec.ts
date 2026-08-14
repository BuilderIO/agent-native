import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accessFilter: vi.fn(() => undefined),
  getDb: vi.fn(),
  getFreeBusy: vi.fn(),
  getSession: vi.fn(),
  getSetting: vi.fn(),
  getUserSetting: vi.fn(),
  isConnected: vi.fn(),
  listEvents: vi.fn(),
  runWithRequestContext: vi.fn(
    async (_context: unknown, fn: () => Promise<unknown>) => fn(),
  ),
  registerShareableResource: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  recordChange: vi.fn(),
  readBody: vi.fn(),
  runWithRequestContext: mocks.runWithRequestContext,
  verifyCaptcha: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: mocks.getSetting,
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("@agent-native/core/sharing", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/sharing")
  >("@agent-native/core/sharing");
  return {
    ...actual,
    accessFilter: mocks.accessFilter,
    registerShareableResource: mocks.registerShareableResource,
  };
});

vi.mock("h3", async () => {
  const actual = await vi.importActual<typeof import("h3")>("h3");
  return {
    ...actual,
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: { query: Record<string, unknown> }) => event.query,
    setResponseStatus: mocks.setResponseStatus,
  };
});

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock("../lib/google-calendar.js", () => ({
  deleteEvent: vi.fn(),
  getDefaultAccountSelection: vi.fn(),
  getFreeBusy: mocks.getFreeBusy,
  isConnected: mocks.isConnected,
  listEvents: mocks.listEvents,
}));

import { schema } from "../db/index.js";
import { getAvailableSlots } from "./bookings.js";

const availability = {
  timezone: "UTC",
  weeklySchedule: {
    monday: { enabled: true, slots: [{ start: "09:00", end: "11:00" }] },
    tuesday: { enabled: false, slots: [] },
    wednesday: { enabled: false, slots: [] },
    thursday: { enabled: false, slots: [] },
    friday: { enabled: false, slots: [] },
    saturday: { enabled: false, slots: [] },
    sunday: { enabled: false, slots: [] },
  },
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxAdvanceDays: 365,
  slotDurationMinutes: 30,
  bookingPageSlug: "book",
};

const bookingLink = {
  ownerEmail: "owner@example.com",
  slug: "saved-meeting",
  hosts: JSON.stringify([{ email: "old-host@example.com" }]),
  duration: 30,
  durations: JSON.stringify([30]),
};

function createDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(async () =>
          table === schema.bookingLinks ? [bookingLink] : [],
        ),
      })),
    })),
  };
}

describe("draft booking availability previews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org-1",
    });
    mocks.getSetting.mockResolvedValue(null);
    mocks.getUserSetting.mockImplementation(async (_email, key) =>
      key === "calendar-availability" ? availability : { timezone: "UTC" },
    );
    mocks.getDb.mockReturnValue(createDb());
    mocks.isConnected.mockResolvedValue(true);
    mocks.getFreeBusy.mockResolvedValue({
      calendars: {
        "owner@example.com": { busy: [] },
        "new-host@example.com": { busy: [] },
      },
      errors: [],
    });
    mocks.listEvents.mockResolvedValue({ events: [], errors: [] });
  });

  it("uses the draft slug, duration, and hosts for a saved link preview", async () => {
    const response = await (getAvailableSlots as any)({
      query: {
        date: "2026-08-17",
        duration: "45",
        slug: "saved-meeting",
        draft: JSON.stringify({
          slug: "updated-meeting",
          durations: [45],
          hosts: [{ email: "new-host@example.com" }],
        }),
      },
    });

    expect(response.slots).toHaveLength(3);
    expect(response.slots[0]).toMatchObject({
      start: "2026-08-17T09:00:00.000Z",
      end: "2026-08-17T09:45:00.000Z",
    });
    expect(mocks.getFreeBusy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      ["owner@example.com", "new-host@example.com"],
      "owner@example.com",
      "UTC",
    );
    expect(mocks.getFreeBusy.mock.calls[0]?.[2]).not.toContain(
      "old-host@example.com",
    );
    expect(mocks.accessFilter).toHaveBeenCalledWith(
      schema.bookingLinks,
      schema.bookingLinkShares,
      undefined,
      "editor",
    );
  });
});
