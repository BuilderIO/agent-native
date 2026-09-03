import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// public-plans.ts imports the db factory at module load; stub it so importing
// the guest-author helpers (which never touch the DB) has no side effects.
vi.mock("../db/index.js", () => ({
  getDb: () => {
    throw new Error("getDb should not be called by guest-author helpers");
  },
  schema: {},
}));

// Drive the real cookie store through an in-memory map so we exercise the actual
// validate/mint/clear logic in public-plans.ts rather than re-implementing it.
const cookieStore = new Map<string, string>();
const setCookieSpy = vi.fn();
const deleteCookieSpy = vi.fn();

vi.mock("h3", () => ({
  getCookie: (_event: unknown, name: string) => cookieStore.get(name),
  setCookie: (
    _event: unknown,
    name: string,
    value: string,
    opts: Record<string, unknown>,
  ) => {
    cookieStore.set(name, value);
    setCookieSpy(name, value, opts);
  },
  deleteCookie: (
    _event: unknown,
    name: string,
    opts: Record<string, unknown>,
  ) => {
    cookieStore.delete(name);
    deleteCookieSpy(name, opts);
  },
  getHeader: (_event: unknown, name: string) =>
    name === "x-forwarded-proto" ? proto : undefined,
}));

const guestAbuseMock = vi.hoisted(() => ({
  tryConsumeGuestMint: vi.fn(async () => true),
}));

vi.mock("./guest-abuse.js", () => ({
  GuestAbuseLimitError: class GuestAbuseLimitError extends Error {
    readonly statusCode = 429;
    constructor(message: string) {
      super(message);
      this.name = "GuestAbuseLimitError";
    }
  },
  tryConsumeGuestMint: guestAbuseMock.tryConsumeGuestMint,
}));

let proto: string | undefined;

const {
  GUEST_AUTHOR_COOKIE,
  clearGuestAuthorCookie,
  isGuestAuthorIdentity,
  readGuestAuthorEmail,
  resolvePlanGuestAuthorOwner,
} = await import("./public-plans.js");

const GUEST_RE = /^guest-[0-9a-f-]{36}@agent-native\.guest$/i;
const fakeEvent = {} as Parameters<typeof readGuestAuthorEmail>[0];

describe("guest-author identity", () => {
  beforeEach(() => {
    cookieStore.clear();
    setCookieSpy.mockClear();
    deleteCookieSpy.mockClear();
    guestAbuseMock.tryConsumeGuestMint.mockClear();
    guestAbuseMock.tryConsumeGuestMint.mockResolvedValue(true);
    proto = undefined;
  });

  afterEach(() => {
    cookieStore.clear();
  });

  describe("GUEST_AUTHOR_COOKIE", () => {
    it("is the documented cookie name", () => {
      expect(GUEST_AUTHOR_COOKIE).toBe("plan_guest_author");
    });
  });

  describe("resolvePlanGuestAuthorOwner", () => {
    it("mints a guest identity + cookie for a first-time visitor", async () => {
      const email = await resolvePlanGuestAuthorOwner(fakeEvent);
      expect(email).toMatch(GUEST_RE);
      expect(isGuestAuthorIdentity(email)).toBe(true);
      expect(guestAbuseMock.tryConsumeGuestMint).toHaveBeenCalledWith(
        fakeEvent,
      );
      expect(setCookieSpy).toHaveBeenCalledTimes(1);
      const [name, value, opts] = setCookieSpy.mock.calls[0];
      expect(name).toBe(GUEST_AUTHOR_COOKIE);
      // Cookie value is the bare UUID; the email derives from it.
      expect(email).toBe(`guest-${value}@agent-native.guest`);
      expect(opts).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      expect(opts.maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });

    it("reuses an existing valid cookie without re-minting", async () => {
      const first = await resolvePlanGuestAuthorOwner(fakeEvent);
      setCookieSpy.mockClear();
      guestAbuseMock.tryConsumeGuestMint.mockClear();
      const second = await resolvePlanGuestAuthorOwner(fakeEvent);
      expect(second).toBe(first);
      expect(setCookieSpy).not.toHaveBeenCalled();
      expect(guestAbuseMock.tryConsumeGuestMint).not.toHaveBeenCalled();
    });

    it("re-mints when the stored cookie is not a valid UUID", async () => {
      cookieStore.set(GUEST_AUTHOR_COOKIE, "not-a-uuid");
      const email = await resolvePlanGuestAuthorOwner(fakeEvent);
      expect(email).toMatch(GUEST_RE);
      expect(guestAbuseMock.tryConsumeGuestMint).toHaveBeenCalledWith(
        fakeEvent,
      );
      expect(setCookieSpy).toHaveBeenCalledTimes(1);
    });

    it("refuses to mint when the guest mint limiter is exhausted", async () => {
      guestAbuseMock.tryConsumeGuestMint.mockResolvedValue(false);

      await expect(
        resolvePlanGuestAuthorOwner(fakeEvent),
      ).rejects.toMatchObject({
        name: "GuestAbuseLimitError",
        statusCode: 429,
      });
      expect(setCookieSpy).not.toHaveBeenCalled();
    });

    it("marks the cookie Secure on https requests", async () => {
      proto = "https";
      await resolvePlanGuestAuthorOwner(fakeEvent);
      expect(setCookieSpy.mock.calls[0][2]).toMatchObject({ secure: true });
    });

    it("does not mark the cookie Secure on http requests", async () => {
      proto = "http";
      await resolvePlanGuestAuthorOwner(fakeEvent);
      expect(setCookieSpy.mock.calls[0][2]).toMatchObject({ secure: false });
    });

    it("keeps two different visitors on distinct identities", async () => {
      const visitorA = await resolvePlanGuestAuthorOwner(fakeEvent);
      cookieStore.clear(); // simulate a second visitor with no cookie
      const visitorB = await resolvePlanGuestAuthorOwner(fakeEvent);
      expect(visitorA).not.toBe(visitorB);
      expect(visitorA).toMatch(GUEST_RE);
      expect(visitorB).toMatch(GUEST_RE);
    });
  });

  describe("readGuestAuthorEmail", () => {
    it("returns null when no cookie is set (no side effects)", () => {
      expect(readGuestAuthorEmail(fakeEvent)).toBeNull();
      expect(setCookieSpy).not.toHaveBeenCalled();
    });

    it("returns the guest email for a valid cookie without minting", async () => {
      const minted = await resolvePlanGuestAuthorOwner(fakeEvent);
      setCookieSpy.mockClear();
      expect(readGuestAuthorEmail(fakeEvent)).toBe(minted);
      expect(setCookieSpy).not.toHaveBeenCalled();
    });

    it("returns null for an invalid cookie value", () => {
      cookieStore.set(GUEST_AUTHOR_COOKIE, "garbage");
      expect(readGuestAuthorEmail(fakeEvent)).toBeNull();
    });
  });

  describe("clearGuestAuthorCookie", () => {
    it("deletes the guest cookie", async () => {
      await resolvePlanGuestAuthorOwner(fakeEvent);
      clearGuestAuthorCookie(fakeEvent);
      expect(deleteCookieSpy).toHaveBeenCalledWith(GUEST_AUTHOR_COOKIE, {
        path: "/",
      });
      expect(readGuestAuthorEmail(fakeEvent)).toBeNull();
    });
  });
});
