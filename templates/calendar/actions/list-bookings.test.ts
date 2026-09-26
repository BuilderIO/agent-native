import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
}));

vi.mock("drizzle-orm", () => ({
  inArray: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    bookingLinks: { slug: "bookingLinks.slug" },
    bookingLinkShares: {},
    bookings: {
      id: "bookings.id",
      name: "bookings.name",
      email: "bookings.email",
      additionalGuestEmails: "bookings.additionalGuestEmails",
      start: "bookings.start",
      end: "bookings.end",
      slug: "bookings.slug",
      eventTitle: "bookings.eventTitle",
      notes: "bookings.notes",
      fieldResponses: "bookings.fieldResponses",
      meetingLink: "bookings.meetingLink",
      meetingLinkPending: "bookings.meetingLinkPending",
      googleEventId: "bookings.googleEventId",
      status: "bookings.status",
      createdAt: "bookings.createdAt",
    },
  },
}));

import listBookingsAction from "./list-bookings";

describe("list-bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const select = vi.fn();
    select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ slug: "intro" }]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: "booking-1",
                name: "Guest",
                email: "guest@example.com",
                additionalGuestEmails: null,
                start: "2026-09-25T09:00:00.000Z",
                end: "2026-09-25T09:30:00.000Z",
                slug: "intro",
                eventTitle: "Intro",
                notes: null,
                fieldResponses: null,
                meetingLink: null,
                meetingLinkPending: true,
                googleEventId: null,
                status: "confirmed",
                createdAt: "2026-09-24T09:00:00.000Z",
              },
            ]),
          })),
        })),
      });
    getDbMock.mockReturnValue({ select });
  });

  it("returns persisted pending meeting state to the host", async () => {
    await expect(listBookingsAction.run({})).resolves.toMatchObject([
      {
        id: "booking-1",
        status: "confirmed",
        meetingLinkPending: true,
      },
    ]);
  });
});
