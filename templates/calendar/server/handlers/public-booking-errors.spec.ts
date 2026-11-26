import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureError: vi.fn(),
  getDb: vi.fn(),
  getRouterParam: vi.fn(),
  getSession: vi.fn(),
  getSetting: vi.fn(),
  readBody: vi.fn(),
  setResponseStatus: vi.fn(),
  verifyCaptcha: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  captureError: mocks.captureError,
  getAppProductionUrl: () => "https://calendar.example.com",
  getForwardedRequestOrigin: () => "https://calendar.example.com",
  getRequestContext: vi.fn(),
  getSession: mocks.getSession,
  readBody: mocks.readBody,
  recordChange: vi.fn(),
  runWithRequestContext: vi.fn(
    async (_context: unknown, fn: () => Promise<unknown>) => fn(),
  ),
  verifyCaptcha: mocks.verifyCaptcha,
  withConfiguredAppBasePath: (url: string) => `${url}/calendar`,
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: mocks.getSetting,
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/sharing")
  >("@agent-native/core/sharing");
  return {
    ...actual,
    accessFilter: vi.fn(),
    registerShareableResource: vi.fn(),
  };
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

vi.mock("../lib/google-calendar.js", () => ({
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  getDefaultAccountSelection: vi.fn(),
  getFreeBusy: vi.fn(),
  isConnected: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("../lib/booking-emails.js", () => ({
  sendBookingCancellationEmails: vi.fn(),
  sendBookingConfirmationEmails: vi.fn(),
}));

vi.mock("../lib/zoom.js", () => ({
  createZoomMeeting: vi.fn(),
  deleteZoomMeeting: vi.fn(),
  needsZoomCancellationReview: vi.fn(() => false),
}));

import { createError } from "h3";

import { getPublicBookingLink } from "./booking-links.js";
import {
  cancelBookingByToken,
  createBooking,
  getAvailableSlots,
  getBookingByToken,
} from "./bookings.js";

const FAILED_SQL =
  'Failed query: select "id", "cancel_token", "email" from "bookings" where "bookings"."cancel_token" = $1 params: secret-booking-token-123';

function databaseError() {
  return Object.assign(new Error(FAILED_SQL), { name: "DrizzleQueryError" });
}

function failDatabase(error: Error = databaseError()) {
  mocks.getDb.mockImplementation(() => {
    throw error;
  });
}

function expectGenericBody(result: unknown) {
  const body = result as { error: string; errorId: string };
  expect(body.error).toBe("Internal server error");
  expect(body.errorId).toMatch(/^[\w-]{10}$/);
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain("Failed query");
  expect(serialized).not.toContain("select");
  expect(serialized).not.toContain("cancel_token");
  expect(serialized).not.toContain("secret-booking-token-123");
  expect(mocks.setResponseStatus).toHaveBeenCalledWith(expect.anything(), 500);
  expect(mocks.captureError).toHaveBeenCalledTimes(1);
  expect(mocks.captureError).toHaveBeenCalledWith(
    expect.objectContaining({ name: "DrizzleQueryError", message: FAILED_SQL }),
    expect.objectContaining({ extra: { errorId: body.errorId } }),
  );
}

describe("public booking endpoints on an unexpected failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRouterParam.mockReturnValue("secret-booking-token-123");
    mocks.getSetting.mockResolvedValue(null);
    mocks.verifyCaptcha.mockResolvedValue({ success: true });
    mocks.readBody.mockResolvedValue({
      captchaToken: "captcha-token",
      email: "guest@example.com",
      end: "2030-01-07T09:30:00.000Z",
      name: "Guest",
      slug: "saved-meeting",
      start: "2030-01-07T09:00:00.000Z",
    });
  });

  it("createBooking returns a generic body with an error id", async () => {
    failDatabase();
    expectGenericBody(await (createBooking as any)({}));
  });

  it("getAvailableSlots returns a generic body with an error id", async () => {
    failDatabase();
    expectGenericBody(
      await (getAvailableSlots as any)({
        query: { date: "2030-01-07", slug: "saved-meeting" },
      }),
    );
  });

  it("getBookingByToken returns a generic body with an error id", async () => {
    failDatabase();
    expectGenericBody(await (getBookingByToken as any)({}));
  });

  it("cancelBookingByToken returns a generic body with an error id", async () => {
    failDatabase();
    expectGenericBody(await (cancelBookingByToken as any)({}));
  });

  it("getPublicBookingLink returns a generic body with an error id", async () => {
    failDatabase();
    mocks.getRouterParam.mockReturnValue("saved-meeting");
    expectGenericBody(await (getPublicBookingLink as any)({ query: {} }));
  });

  it("does not return the message of a provider error that only carries a statusCode", async () => {
    failDatabase(
      Object.assign(new Error("Zoom said: invalid access token abc123"), {
        statusCode: 400,
      }),
    );
    const result = (await (cancelBookingByToken as any)({})) as {
      error: string;
    };
    expect(result.error).toBe("Internal server error");
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      500,
    );
  });
});

describe("public booking endpoints on an error raised for the caller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSetting.mockResolvedValue(null);
  });

  it("keeps the message and status of an h3 error", async () => {
    failDatabase(
      createError({ statusCode: 404, statusMessage: "Booking link not found" }),
    );
    const result = await (getAvailableSlots as any)({
      query: { date: "2030-01-07", slug: "saved-meeting" },
    });
    expect(result).toEqual({ error: "Booking link not found" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      404,
    );
    expect(mocks.captureError).not.toHaveBeenCalled();
  });
});
