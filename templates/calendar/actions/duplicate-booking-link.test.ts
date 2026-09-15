import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, insertValuesMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  insertValuesMock: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "new-owner@example.com"),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values) => ({ kind: "and", values })),
  eq: vi.fn((left, right) => ({ kind: "eq", left, right })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    bookingLinks: {
      id: "booking_links.id",
      slug: "booking_links.slug",
    },
    bookingSlugRedirects: {
      oldSlug: "booking_slug_redirects.old_slug",
    },
  },
}));

vi.mock("../server/lib/booking-link-utils.js", () => ({
  rowToBookingLink: vi.fn((row) => row),
}));

import duplicateBookingLinkAction from "./duplicate-booking-link";

const source = {
  id: "source-link",
  slug: "team",
  title: "Team",
  description: null,
  duration: 30,
  durations: null,
  hosts: null,
  customFields: null,
  conferencing: null,
  color: null,
  isActive: true,
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  visibility: "org" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function selectWithLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function selectWithoutLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows),
    })),
  };
}

describe("duplicate-booking-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValuesMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce(selectWithLimit([source]))
        .mockReturnValueOnce(selectWithLimit([]))
        .mockReturnValueOnce(selectWithLimit([]))
        .mockReturnValueOnce(selectWithLimit([]))
        .mockReturnValueOnce(selectWithoutLimit([{ ...source, id: "copy" }])),
      insert: vi.fn(() => ({ values: insertValuesMock })),
    });
  });

  it("makes a duplicated org-visible link private to its new owner", async () => {
    await duplicateBookingLinkAction.run({
      sourceId: source.id,
      copies: [{ title: "Private copy", slug: "private-copy" }],
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "new-owner@example.com",
        orgId: "org-1",
        visibility: "private",
      }),
    );
  });
});
