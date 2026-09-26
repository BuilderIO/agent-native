import { describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
}));

vi.mock("drizzle-orm", () => ({
  inArray: vi.fn(() => ({ kind: "in-array" })),
}));

const schemaMock = vi.hoisted(() => ({
  bookingLinks: {
    slug: "bookingLinks.slug",
    conferencing: "bookingLinks.conferencing",
  },
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
    zoomMeetingId: "bookings.zoomMeetingId",
    zoomAccountId: "bookings.zoomAccountId",
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
      zoomMeetingId: null,
      zoomAccountId: null,
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
        zoomCancellationNeedsReview: true,
      },
    ]);
  });

  it("flags existing Zoom links without saved provider IDs for manual review", async () => {
    const booking = {
      id: "booking-2",
      name: "Guest",
      email: "guest@example.com",
      additionalGuestEmails: null,
      start: "2026-09-25T23:30:00.000Z",
      end: "2026-09-26T00:00:00.000Z",
      slug: "saved-meeting",
      eventTitle: "Planning",
      notes: null,
      fieldResponses: null,
      meetingLink: "https://us05web.zoom.us/j/123456789",
      googleEventId: null,
      zoomNeedsReview: false,
      zoomMeetingId: null,
      zoomAccountId: null,
      status: "confirmed",
      createdAt: "2026-09-25T17:00:00.000Z",
    };
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn((table) => ({
          where: vi.fn(() =>
            table === schemaMock.bookingLinks
              ? Promise.resolve([{ slug: booking.slug }])
              : { orderBy: vi.fn(async () => [booking]) },
          ),
        })),
      })),
    });

    await expect(
      action.run({} as never, undefined as never),
    ).resolves.toMatchObject([
      { id: "booking-2", zoomCancellationNeedsReview: true },
    ]);
  });

  it("flags legacy Zoom bookings from their link config when no meeting data was saved", async () => {
    const booking = {
      id: "booking-3",
      name: "Guest",
      email: "guest@example.com",
      additionalGuestEmails: null,
      start: "2026-09-25T23:30:00.000Z",
      end: "2026-09-26T00:00:00.000Z",
      slug: "legacy-zoom",
      eventTitle: "Planning",
      notes: null,
      fieldResponses: null,
      meetingLink: null,
      googleEventId: null,
      zoomNeedsReview: false,
      zoomMeetingId: null,
      zoomAccountId: null,
      status: "confirmed",
      createdAt: "2026-09-25T17:00:00.000Z",
    };
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn((table) => ({
          where: vi.fn(() =>
            table === schemaMock.bookingLinks
              ? Promise.resolve([
                  {
                    slug: booking.slug,
                    conferencing: JSON.stringify({ type: "zoom" }),
                  },
                ])
              : { orderBy: vi.fn(async () => [booking]) },
          ),
        })),
      })),
    });

    await expect(
      action.run({} as never, undefined as never),
    ).resolves.toMatchObject([
      {
        id: "booking-3",
        zoomNeedsReview: false,
        zoomCancellationNeedsReview: true,
      },
    ]);
  });
});
