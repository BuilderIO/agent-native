import { beforeEach, describe, expect, it, vi } from "vitest";

// defineEventHandler just wraps the handler; return it as-is so we can invoke it.
vi.mock("h3", () => ({ defineEventHandler: (fn: unknown) => fn }));

// Capture the query fragments structurally instead of executing real SQL.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
}));

const getSessionMock = vi.fn();
vi.mock("@agent-native/core/server", () => ({ getSession: getSessionMock }));

const updateSpy = vi.fn();
const setSpy = vi.fn();
const whereSpy = vi.fn();
const dbRecorder = {
  update: (table: unknown) => {
    updateSpy(table);
    return {
      set: (vals: unknown) => {
        setSpy(vals);
        return {
          where: (cond: unknown) => {
            whereSpy(cond);
            return Promise.resolve();
          },
        };
      },
    };
  },
};
vi.mock("../db/index.js", () => ({
  getDb: () => dbRecorder,
  schema: { plans: { ownerEmail: "plans.owner_email", orgId: "plans.org_id" } },
}));

const readGuestAuthorEmailMock = vi.fn();
const clearGuestAuthorCookieMock = vi.fn();
vi.mock("../lib/public-plans.js", () => ({
  readGuestAuthorEmail: (event: unknown) => readGuestAuthorEmailMock(event),
  clearGuestAuthorCookie: (event: unknown) => clearGuestAuthorCookieMock(event),
  isGuestAuthorIdentity: (email: unknown) =>
    typeof email === "string" &&
    /^guest-[0-9a-f-]+@agent-native\.guest$/i.test(email),
}));

const { default: handler } = await import("./claim-guest-plans.js");

const EVENT = {} as never;
const GUEST = "guest-11111111-1111-1111-1111-111111111111@agent-native.guest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claim-guest-plans middleware", () => {
  it("no-ops (no session lookup, no DB) when there is no guest cookie", async () => {
    readGuestAuthorEmailMock.mockReturnValue(null);
    await (handler as (e: never) => Promise<void>)(EVENT);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(clearGuestAuthorCookieMock).not.toHaveBeenCalled();
  });

  it("no-ops for an anonymous guest with no real session", async () => {
    readGuestAuthorEmailMock.mockReturnValue(GUEST);
    getSessionMock.mockResolvedValue(null);
    await (handler as (e: never) => Promise<void>)(EVENT);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(clearGuestAuthorCookieMock).not.toHaveBeenCalled();
  });

  it("skips when the session is itself a synthetic guest identity", async () => {
    readGuestAuthorEmailMock.mockReturnValue(GUEST);
    getSessionMock.mockResolvedValue({
      email: "guest-22222222-2222-2222-2222-222222222222@agent-native.guest",
    });
    await (handler as (e: never) => Promise<void>)(EVENT);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(clearGuestAuthorCookieMock).not.toHaveBeenCalled();
  });

  it("claims guest plans onto a real account, scoped to the caller's guest id, then clears the cookie", async () => {
    readGuestAuthorEmailMock.mockReturnValue(GUEST);
    getSessionMock.mockResolvedValue({ email: "real@user.com" });
    await (handler as (e: never) => Promise<void>)(EVENT);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    // Only the owner is re-keyed; nothing else is mutated.
    expect(setSpy).toHaveBeenCalledWith({ ownerEmail: "real@user.com" });
    // Scoped to THIS guest's rows and never org-scoped (real) plans.
    expect(whereSpy).toHaveBeenCalledWith({
      op: "and",
      args: [
        { op: "eq", col: "plans.owner_email", val: GUEST },
        { op: "isNull", col: "plans.org_id" },
      ],
    });
    expect(clearGuestAuthorCookieMock).toHaveBeenCalledTimes(1);
  });

  it("never breaks the request, and leaves the cookie, if the claim UPDATE throws", async () => {
    readGuestAuthorEmailMock.mockReturnValue(GUEST);
    getSessionMock.mockResolvedValue({ email: "real@user.com" });
    updateSpy.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(
      (handler as (e: never) => Promise<void>)(EVENT),
    ).resolves.toBeUndefined();
    // Cookie is preserved so the next authenticated request retries the claim.
    expect(clearGuestAuthorCookieMock).not.toHaveBeenCalled();
  });
});
