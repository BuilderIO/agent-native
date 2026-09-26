import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, updateSetMock, rowToBookingLinkMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateSetMock: vi.fn(),
  rowToBookingLinkMock: vi.fn((row) => row),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "owner" }),
}));

vi.mock("../server/db/index.js", () => ({
  schema: {
    bookingLinks: {
      id: "booking_links.id",
      slug: "booking_links.slug",
      ownerEmail: "booking_links.owner_email",
      isActive: "booking_links.is_active",
      conferencing: "booking_links.conferencing",
    },
    bookings: {
      slug: "bookings.slug",
      status: "bookings.status",
      zoomMeetingId: "bookings.zoom_meeting_id",
      zoomAccountId: "bookings.zoom_account_id",
    },
    bookingSlugRedirects: {
      oldSlug: "booking_slug_redirects.old_slug",
    },
  },
  getDb: () => ({
    select: selectMock,
    update: () => ({
      set: updateSetMock.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
}));

vi.mock("../server/lib/booking-link-utils.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../server/lib/booking-link-utils.js")
    >();
  return {
    ...actual,
    rowToBookingLink: rowToBookingLinkMock,
    serializeBookingHosts: vi.fn(() => null),
  };
});

import updateBookingLinkAction from "./update-booking-link";

function selectResult(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe("update-booking-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(
        selectResult([
          {
            slug: "old-slug",
            ownerEmail: "owner@example.com",
            isActive: false,
            conferencing: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        selectResult([
          {
            id: "booking-link-1",
            slug: "old-slug",
            isActive: false,
          },
        ]),
      );
  });

  it("preserves a disabled link when updating fields without isActive", async () => {
    await updateBookingLinkAction.run({
      id: "booking-link-1",
      title: "Updated title",
      slug: "old-slug",
      duration: 30,
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated title",
        isActive: false,
      }),
    );
  });

  it("keeps legacy Zoom bookings under review when the link changes provider", async () => {
    selectMock.mockReset();
    selectMock
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(
        selectResult([
          {
            slug: "old-slug",
            ownerEmail: "owner@example.com",
            isActive: true,
            conferencing: JSON.stringify({ type: "zoom" }),
          },
        ]),
      )
      .mockReturnValueOnce(
        selectResult([{ id: "booking-link-1", slug: "old-slug" }]),
      );

    await updateBookingLinkAction.run({
      id: "booking-link-1",
      title: "Updated title",
      slug: "old-slug",
      duration: 30,
      conferencing: { type: "custom", url: "https://meet.example.com/room" },
    });

    expect(updateSetMock).toHaveBeenNthCalledWith(1, {
      zoomNeedsReview: true,
    });
    expect(updateSetMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conferencing: JSON.stringify({
          type: "custom",
          url: "https://meet.example.com/room",
        }),
      }),
    );
  });
});
