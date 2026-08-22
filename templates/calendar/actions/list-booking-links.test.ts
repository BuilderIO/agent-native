import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, resolveAccessMock, rowToBookingLinkMock } = vi.hoisted(
  () => ({
    getDbMock: vi.fn(),
    resolveAccessMock: vi.fn(),
    rowToBookingLinkMock: vi.fn((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      duration: row.duration,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  }),
);

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
  resolveAccess: resolveAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn(() => ({})),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    bookingLinks: { updatedAt: "booking_links.updated_at" },
    bookingLinkShares: {},
  },
}));

vi.mock("../server/lib/booking-link-utils.js", () => ({
  rowToBookingLink: rowToBookingLinkMock,
}));

import listBookingLinksAction from "./list-booking-links";

describe("list-booking-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: "booking-link-1",
                slug: "intro",
                title: "Intro",
                duration: 30,
                isActive: true,
                createdAt: "2026-08-22T00:00:00.000Z",
                updatedAt: "2026-08-22T00:00:00.000Z",
              },
            ]),
          })),
        })),
      })),
    });
  });

  it("returns the effective access role for each booking link", async () => {
    resolveAccessMock.mockResolvedValue({ role: "viewer" });

    await expect(listBookingLinksAction.run({})).resolves.toEqual([
      expect.objectContaining({
        id: "booking-link-1",
        accessRole: "viewer",
      }),
    ]);
  });
});
