import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, updateSetMock, rowToBookingLinkMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateSetMock: vi.fn(),
  rowToBookingLinkMock: vi.fn((row) => row),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
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

vi.mock("../server/lib/booking-link-utils.js", () => ({
  rowToBookingLink: rowToBookingLinkMock,
  serializeBookingHosts: vi.fn(() => null),
}));

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
});
