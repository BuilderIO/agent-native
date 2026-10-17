import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertAccessMock,
  getDbMock,
  selectProjectionMock,
  selectRowsMock,
  deleteWhereMock,
} = vi.hoisted(() => ({
  assertAccessMock: vi.fn(),
  getDbMock: vi.fn(),
  selectProjectionMock: vi.fn(),
  selectRowsMock: vi.fn(),
  deleteWhereMock: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: vi.fn(),
  readBody: vi.fn(),
  runWithRequestContext: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn(),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("h3", () => ({
  createError: vi.fn(({ statusCode, statusMessage }) =>
    Object.assign(new Error(statusMessage), { statusCode }),
  ),
  defineEventHandler: vi.fn((handler) => handler),
  getQuery: vi.fn(),
  getRouterParam: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: vi.fn() }));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    bookingLinks: {
      id: "booking_links.id",
      slug: "booking_links.slug",
      title: "booking_links.title",
      duration: "booking_links.duration",
    },
    bookingSlugRedirects: {
      newSlug: "booking_slug_redirects.new_slug",
    },
  },
}));

vi.mock("../lib/booking-durations.js", () => ({
  normalizeBookingDurationInput: vi.fn(),
}));

vi.mock("../lib/booking-host-availability.js", () => ({
  getEligibleHostAvailability: vi.fn(),
  withHostTimezones: vi.fn(),
}));

vi.mock("../lib/booking-link-utils.js", () => ({
  getBookingLinkRequiredHostEmails: vi.fn(),
  rowToBookingLink: vi.fn(),
  serializeBookingHosts: vi.fn(),
}));

vi.mock("../lib/booking-og-image.js", () => ({
  displayNameFromIdentifier: vi.fn(),
}));

vi.mock("../lib/booking-timezone.js", () => ({
  getOwnerBookingTimeZone: vi.fn(),
}));

vi.mock("./booking-usernames.js", () => ({
  ensureBookingUsername: vi.fn(),
}));

import { deleteBookingLinkById } from "./booking-links";

describe("deleteBookingLinkById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
    selectRowsMock.mockResolvedValue([
      {
        slug: "private-slug",
        title: "Consultation",
        duration: 45,
        hosts: '[{"email":"host@example.com"}]',
        description: "Private booking details",
      },
    ]);
    deleteWhereMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({
      select: vi.fn((projection) => {
        selectProjectionMock(projection);
        return { from: vi.fn(() => ({ where: selectRowsMock })) };
      }),
      delete: vi.fn(() => ({ where: deleteWhereMock })),
    });
  });

  it("returns only the deleted title and duration", async () => {
    const result = await deleteBookingLinkById("booking-link-1");

    expect(result).toEqual({
      ok: true,
      title: "Consultation",
      duration: 45,
    });
    expect(result).not.toHaveProperty("slug");
    expect(result).not.toHaveProperty("hosts");
    expect(result).not.toHaveProperty("description");
    expect(selectProjectionMock).toHaveBeenCalledWith({
      slug: "booking_links.slug",
      title: "booking_links.title",
      duration: "booking_links.duration",
    });
  });
});
