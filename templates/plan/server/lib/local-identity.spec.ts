import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GUEST_AUTHOR_DOMAIN,
  LOCAL_PLAN_OWNER_EMAIL,
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  isLocalPlanRuntime,
  requirePlanOwnerEmailForWrite,
  resolvePlanOwnerEmail,
  resolvePlanOwnerEmailForWrite,
} from "./local-identity.js";

const GUEST_EMAIL = `guest-123e4567-e89b-12d3-a456-426614174000@${GUEST_AUTHOR_DOMAIN}`;

const ENV_KEYS = ["NODE_ENV", "AUTH_MODE", "PLAN_LOCAL_MODE"] as const;

describe("local-identity", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) process.env[key] = value;
    }
  }

  describe("isLocalPlanRuntime", () => {
    it("is true in development with no AUTH_MODE", () => {
      setEnv({ NODE_ENV: "development" });
      expect(isLocalPlanRuntime()).toBe(true);
    });

    it("is true in development with AUTH_MODE=local", () => {
      setEnv({ NODE_ENV: "development", AUTH_MODE: "local" });
      expect(isLocalPlanRuntime()).toBe(true);
    });

    it("is true when NODE_ENV is unset (CLI/test) and AUTH_MODE unset", () => {
      setEnv({});
      expect(isLocalPlanRuntime()).toBe(true);
    });

    it("NEVER activates in production, even with AUTH_MODE=local", () => {
      setEnv({ NODE_ENV: "production", AUTH_MODE: "local" });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("NEVER activates in production, even with PLAN_LOCAL_MODE=1", () => {
      setEnv({ NODE_ENV: "production", PLAN_LOCAL_MODE: "1" });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("is false when a non-local AUTH_MODE is in play", () => {
      setEnv({ NODE_ENV: "development", AUTH_MODE: "hosted" });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("honors explicit PLAN_LOCAL_MODE=0 opt-out in dev", () => {
      setEnv({ NODE_ENV: "development", PLAN_LOCAL_MODE: "0" });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("honors explicit PLAN_LOCAL_MODE=1 opt-in (non-production)", () => {
      setEnv({
        NODE_ENV: "development",
        AUTH_MODE: "local",
        PLAN_LOCAL_MODE: "1",
      });
      expect(isLocalPlanRuntime()).toBe(true);
    });
  });

  describe("resolvePlanOwnerEmail", () => {
    it("always honors the authenticated user", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmail("user@example.com")).toBe(
        "user@example.com",
      );
    });

    it("falls back to the local identity in local mode", () => {
      setEnv({ NODE_ENV: "development" });
      expect(resolvePlanOwnerEmail(undefined)).toBe(LOCAL_PLAN_OWNER_EMAIL);
    });

    it("returns undefined when hosted and unauthenticated", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmail(undefined)).toBeUndefined();
    });
  });

  describe("resolvePlanOwnerEmailForWrite", () => {
    it("honors a real authenticated user (hosted)", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmailForWrite("user@example.com")).toBe(
        "user@example.com",
      );
    });

    it("accepts the hosted guest-author identity injected by the resolver", () => {
      // On a hosted deploy the anonymousOwner resolver injects the guest email
      // into the request context, so it arrives here in the authenticated slot.
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmailForWrite(GUEST_EMAIL)).toBe(GUEST_EMAIL);
    });

    it("falls back to the local identity in local mode", () => {
      setEnv({ NODE_ENV: "development" });
      expect(resolvePlanOwnerEmailForWrite(undefined)).toBe(
        LOCAL_PLAN_OWNER_EMAIL,
      );
    });

    it("returns undefined when hosted, unauthenticated, and no guest", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmailForWrite(undefined)).toBeUndefined();
    });

    it("matches resolvePlanOwnerEmail for the non-guest paths (no drift)", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmailForWrite("u@example.com")).toBe(
        resolvePlanOwnerEmail("u@example.com"),
      );
      expect(resolvePlanOwnerEmailForWrite(undefined)).toBe(
        resolvePlanOwnerEmail(undefined),
      );
    });
  });

  describe("requirePlanOwnerEmailForWrite", () => {
    it("throws in hosted mode with no user and no guest", () => {
      setEnv({ NODE_ENV: "production" });
      expect(() =>
        requirePlanOwnerEmailForWrite(undefined, "Creating a plan"),
      ).toThrow(/requires an authenticated user/);
    });

    it("returns the guest identity for a hosted guest author", () => {
      setEnv({ NODE_ENV: "production" });
      expect(
        requirePlanOwnerEmailForWrite(GUEST_EMAIL, "Creating a plan"),
      ).toBe(GUEST_EMAIL);
    });

    it("returns the local identity in local mode", () => {
      setEnv({ NODE_ENV: "development" });
      expect(requirePlanOwnerEmailForWrite(undefined, "Creating a plan")).toBe(
        LOCAL_PLAN_OWNER_EMAIL,
      );
    });
  });

  describe("isGuestAuthorIdentity", () => {
    it("matches the guest-author identity shape", () => {
      expect(isGuestAuthorIdentity(GUEST_EMAIL)).toBe(true);
    });

    it("does not match the public-viewer identity", () => {
      expect(
        isGuestAuthorIdentity(
          "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local",
        ),
      ).toBe(false);
    });

    it("does not match the local single-user identity", () => {
      expect(isGuestAuthorIdentity(LOCAL_PLAN_OWNER_EMAIL)).toBe(false);
    });

    it("does not match a real account", () => {
      expect(isGuestAuthorIdentity("user@example.com")).toBe(false);
    });

    it("handles null / undefined", () => {
      expect(isGuestAuthorIdentity(null)).toBe(false);
      expect(isGuestAuthorIdentity(undefined)).toBe(false);
    });
  });

  describe("isAnonymousPublicViewer", () => {
    it("matches the public-viewer identity shape", () => {
      expect(
        isAnonymousPublicViewer(
          "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local",
        ),
      ).toBe(true);
    });

    it("does not match the local single-user identity", () => {
      expect(isAnonymousPublicViewer(LOCAL_PLAN_OWNER_EMAIL)).toBe(false);
    });

    it("does not match the hosted guest-author identity", () => {
      expect(isAnonymousPublicViewer(GUEST_EMAIL)).toBe(false);
    });

    it("does not match a real account", () => {
      expect(isAnonymousPublicViewer("user@example.com")).toBe(false);
    });

    it("handles null / undefined", () => {
      expect(isAnonymousPublicViewer(null)).toBe(false);
      expect(isAnonymousPublicViewer(undefined)).toBe(false);
    });
  });
});
