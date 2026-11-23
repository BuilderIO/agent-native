import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureBookingUsername: vi.fn(),
  getDb: vi.fn(),
  getRouterParam: vi.fn(),
  getSingleUseLinkStatus: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/sharing")
  >("@agent-native/core/sharing");
  return { ...actual, registerShareableResource: vi.fn() };
});

vi.mock("h3", async () => {
  const actual = await vi.importActual<typeof import("h3")>("h3");
  return {
    ...actual,
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: { query: Record<string, unknown> }) => event.query,
    getRouterParam: mocks.getRouterParam,
    setResponseStatus: mocks.setResponseStatus,
  };
});

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return { ...actual, getDb: mocks.getDb };
});

vi.mock("../lib/single-use-links.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/single-use-links.js")
  >("../lib/single-use-links.js");
  return { ...actual, getSingleUseLinkStatus: mocks.getSingleUseLinkStatus };
});

vi.mock("../lib/booking-host-availability.js", () => ({
  getEligibleHostAvailability: vi.fn(async () => []),
  withHostTimezones: (bookingLink: unknown) => bookingLink,
}));

vi.mock("../lib/booking-timezone.js", () => ({
  getOwnerBookingTimeZone: vi.fn(async () => "UTC"),
}));

vi.mock("./booking-usernames.js", () => ({
  ensureBookingUsername: mocks.ensureBookingUsername,
}));

import { getPublicBookingLink } from "./booking-links.js";

const linkRow = {
  id: "link-1",
  slug: "intro",
  title: "Intro",
  description: null,
  duration: 30,
  durations: null,
  hosts: null,
  customFields: null,
  conferencing: null,
  color: null,
  isActive: true,
  ownerEmail: "owner@example.com",
  orgId: null,
  visibility: "private",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

type PublicLinkResponse = {
  singleUse?: { status: string };
  redirectPath?: string;
};

const open = (query: Record<string, unknown>) =>
  (
    getPublicBookingLink as unknown as (event: {
      query: Record<string, unknown>;
    }) => Promise<PublicLinkResponse>
  )({ query: { username: "owner", ...query } });

describe("public booking link with a single-use token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRouterParam.mockReturnValue("intro");
    mocks.ensureBookingUsername.mockResolvedValue("owner");
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({ where: async () => [linkRow] }),
      }),
    });
  });

  it("leaves singleUse out of a plain link", async () => {
    const response = await open({});

    expect(response).toMatchObject({ id: "link-1", slug: "intro" });
    expect(response).not.toHaveProperty("singleUse");
    expect(mocks.getSingleUseLinkStatus).not.toHaveBeenCalled();
  });

  it.each(["available", "used", "revoked", "missing"])(
    "reports a %s token",
    async (status) => {
      mocks.getSingleUseLinkStatus.mockResolvedValue(status);

      const response = await open({ once: "single-use-token-1" });

      expect(response.singleUse).toEqual({ status });
      expect(mocks.getSingleUseLinkStatus).toHaveBeenCalledWith(
        "link-1",
        "single-use-token-1",
      );
    },
  );

  it.each(["", "x", "has spaces in it", ["a", "b"]])(
    "reports a malformed token %j as missing without looking it up",
    async (once) => {
      const response = await open({ once });

      expect(response.singleUse).toEqual({ status: "missing" });
      expect(mocks.getSingleUseLinkStatus).not.toHaveBeenCalled();
    },
  );

  it("redirects a wrong username without reading the token", async () => {
    const response = await open({
      username: "someone-else",
      once: "single-use-token-1",
    });

    expect(response).toEqual({ redirectPath: "/book/owner/intro" });
    expect(mocks.getSingleUseLinkStatus).not.toHaveBeenCalled();
  });
});
