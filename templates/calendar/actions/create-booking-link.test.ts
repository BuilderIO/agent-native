import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildDeepLinkMock, getDbMock, insertValuesMock, selectMock } =
  vi.hoisted(() => ({
    buildDeepLinkMock: vi.fn(
      () => "/_agent-native/open?bookingLinkId=booking-link-1",
    ),
    getDbMock: vi.fn(),
    insertValuesMock: vi.fn(),
    selectMock: vi.fn(),
  }));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: buildDeepLinkMock,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "booking-link-1"),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    bookingLinks: { id: "booking_links.id", slug: "booking_links.slug" },
    bookingSlugRedirects: { oldSlug: "booking_slug_redirects.old_slug" },
  },
}));

vi.mock("../server/lib/booking-link-utils.js", () => ({
  rowToBookingLink: vi.fn((row) => row),
  serializeBookingHosts: vi.fn(() => '[{"email":"cohost@example.com"}]'),
}));

import action from "./create-booking-link";

function selectResult(rows: unknown[]) {
  return {
    from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(rows) })),
  };
}

describe("create-booking-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(
        selectResult([
          {
            id: "booking-link-1",
            title: "Consultation",
            slug: "consultation",
            duration: 30,
            description: "Private booking details",
            hosts: '[{"email":"cohost@example.com"}]',
            conferencing:
              '{"type":"custom","url":"https://meet.example.test/room"}',
          },
        ]),
      );
    insertValuesMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({
      select: selectMock,
      insert: vi.fn(() => ({ values: insertValuesMock })),
    });
  });

  it("returns a compact card with a deep link to the created booking link", async () => {
    const result = await action.run({
      title: "Consultation",
      slug: "consultation",
      duration: 30,
      description: "Private booking details",
      hosts: ["cohost@example.com"],
      conferencing: {
        type: "custom",
        url: "https://meet.example.test/room",
      },
    });

    expect(result.change).toEqual({
      verb: "created",
      kind: "booking-link",
      title: "Consultation",
      detail: "30",
      url: "/_agent-native/open?bookingLinkId=booking-link-1",
    });
    expect(JSON.stringify(result.change)).not.toContain(
      "Private booking details",
    );
    expect(JSON.stringify(result.change)).not.toContain("cohost@example.com");
    expect(JSON.stringify(result.change)).not.toContain("meet.example.test");
    expect(buildDeepLinkMock).toHaveBeenCalledWith({
      app: "calendar",
      view: "booking-links",
      params: { bookingLinkId: "booking-link-1" },
    });
  });
});
