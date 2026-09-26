import { describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
}));

vi.mock("drizzle-orm", () => ({
  inArray: vi.fn(() => ({ kind: "in-array" })),
}));

const schemaMock = vi.hoisted(() => ({
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
    googleEventId: "bookings.googleEventId",
    zoomNeedsReview: "bookings.zoomNeedsReview",
    status: "bookings.status",
    createdAt: "bookings.createdAt",
  },
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));

import action from "./list-bookings";

describe("list-bookings", () => {
  it("exposes ambiguous Zoom reservations for owner review", async () => {
    const booking = {
      id: "booking-1",
      name: "Java Yang",
      email: "java@example.com",
      additionalGuestEmails: null,
      start: "2026-09-25T23:30:00.000Z",
      end: "2026-09-26T00:00:00.000Z",
      slug: "jason-yang/30-mins",
      eventTitle: "Jyang + Java",
      notes: null,
      fieldResponses: null,
      meetingLink: null,
      googleEventId: null,
      zoomNeedsReview: true,
      status: "confirmed",
      createdAt: "2026-09-25T17:00:00.000Z",
    };
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn((table) => ({
          where: vi.fn(() =>
            table === schemaMock.bookingLinks
              ? Promise.resolve([{ slug: booking.slug }])
              : {
                  orderBy: vi.fn(async () => [booking]),
                },
          ),
        })),
      })),
    });

    await expect(
      action.run({} as never, undefined as never),
    ).resolves.toMatchObject([
      {
        id: "booking-1",
        status: "confirmed",
        zoomNeedsReview: true,
      },
    ]);
  });
});
