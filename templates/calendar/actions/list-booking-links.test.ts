import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, rowToBookingLinkMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  rowToBookingLinkMock: vi.fn((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    duration: row.duration,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
  ROLE_RANK: { viewer: 1, commenter: 2, editor: 3, admin: 4 },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "OWNER@example.com"),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values) => values),
  desc: vi.fn(() => ({})),
  eq: vi.fn((left, right) => ({ left, right })),
  inArray: vi.fn((left, right) => ({ left, right })),
  or: vi.fn((...values) => values),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    bookingLinks: {
      updatedAt: "booking_links.updated_at",
    },
    bookingLinkShares: {
      principalType: "booking_link_shares.principal_type",
      principalId: "booking_link_shares.principal_id",
      resourceId: "booking_link_shares.resource_id",
      role: "booking_link_shares.role",
    },
  },
}));

vi.mock("../server/lib/booking-link-utils.js", () => ({
  rowToBookingLink: rowToBookingLinkMock,
}));

import listBookingLinksAction from "./list-booking-links";

describe("list-booking-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const rows = [
      {
        id: "booking-link-owner",
        slug: "intro",
        title: "Intro",
        duration: 30,
        isActive: true,
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
      {
        id: "booking-link-shared",
        slug: "team",
        title: "Team",
        duration: 45,
        isActive: true,
        ownerEmail: "other@example.com",
        orgId: "org-1",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
    ];
    const shareRows = [
      { resourceId: "booking-link-shared", role: "editor" as const },
    ];
    const selectMock = vi.fn();
    selectMock
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn().mockResolvedValue(rows),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(shareRows),
        })),
      });
    getDbMock.mockReturnValue({
      select: selectMock,
    });
  });

  it("returns owner and shared roles from one batched share lookup", async () => {
    await expect(listBookingLinksAction.run({})).resolves.toEqual([
      expect.objectContaining({
        id: "booking-link-owner",
        accessRole: "owner",
      }),
      expect.objectContaining({
        id: "booking-link-shared",
        accessRole: "editor",
      }),
    ]);
    expect(getDbMock().select).toHaveBeenCalledTimes(2);
  });
});
