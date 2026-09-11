import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GUEST_AUTHOR_DOMAIN,
  LOCAL_PLAN_OWNER_EMAIL,
  getLocalPlanOwnerEmail,
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  isLocalPlanRuntime,
  requirePlanOwnerEmailForWrite,
  resolvePlanAccessContext,
  resolvePlanOrgIdForWrite,
  resolvePlanOwnerEmail,
  resolvePlanOwnerEmailForWrite,
} from "./local-identity.js";

const GUEST_EMAIL = `guest-123e4567-e89b-12d3-a456-426614174000@${GUEST_AUTHOR_DOMAIN}`;
const PUBLIC_VIEWER_EMAIL =
  "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local";

const ENV_KEYS = [
  "NODE_ENV",
  "AUTH_MODE",
  "PLAN_LOCAL_MODE",
  "PLAN_LOCAL_OWNER_EMAIL",
] as const;

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
    it("honors the authenticated user in hosted mode", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmail("user@example.com")).toBe(
        "user@example.com",
      );
    });

    it("uses the local identity for authenticated users in local mode", () => {
      setEnv({ NODE_ENV: "development" });
      expect(resolvePlanOwnerEmail("user@example.com")).toBe(
        LOCAL_PLAN_OWNER_EMAIL,
      );
    });

    it("falls back to the local identity in local mode", () => {
      setEnv({ NODE_ENV: "development" });
      expect(resolvePlanOwnerEmail(undefined)).toBe(LOCAL_PLAN_OWNER_EMAIL);
    });

    it("uses PLAN_LOCAL_OWNER_EMAIL as the local identity override", () => {
      setEnv({
        NODE_ENV: "development",
        PLAN_LOCAL_OWNER_EMAIL: "owner@example.com",
      });
      expect(getLocalPlanOwnerEmail()).toBe("owner@example.com");
      expect(resolvePlanOwnerEmail(undefined)).toBe("owner@example.com");
      expect(resolvePlanOwnerEmail("user@example.com")).toBe(
        "owner@example.com",
      );
    });

    it("returns undefined when hosted and unauthenticated", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmail(undefined)).toBeUndefined();
    });

    it("does not use PLAN_LOCAL_OWNER_EMAIL in production", () => {
      setEnv({
        NODE_ENV: "production",
        PLAN_LOCAL_MODE: "1",
        PLAN_LOCAL_OWNER_EMAIL: "owner@example.com",
      });
      expect(resolvePlanOwnerEmail(undefined)).toBeUndefined();
      expect(resolvePlanOwnerEmail("user@example.com")).toBe(
        "user@example.com",
      );
    });
  });

  describe("resolvePlanAccessContext", () => {
    it("maps a signed-in local browser to the local owner", () => {
      setEnv({ NODE_ENV: "development" });
      expect(
        resolvePlanAccessContext({
          userEmail: "user@example.com",
          orgId: "org_1",
        }),
      ).toEqual({ userEmail: LOCAL_PLAN_OWNER_EMAIL });
    });

    it("maps local access to PLAN_LOCAL_OWNER_EMAIL when configured", () => {
      setEnv({
        NODE_ENV: "development",
        PLAN_LOCAL_OWNER_EMAIL: "owner@example.com",
      });
      expect(
        resolvePlanAccessContext({
          userEmail: "user@example.com",
          orgId: "org_1",
        }),
      ).toEqual({ userEmail: "owner@example.com" });
    });

    it("does not upgrade public-link viewers to local owner/editor", () => {
      setEnv({ NODE_ENV: "development" });
      expect(
        resolvePlanAccessContext({ userEmail: PUBLIC_VIEWER_EMAIL }),
      ).toEqual({ userEmail: PUBLIC_VIEWER_EMAIL });
    });
  });

  describe("resolvePlanOrgIdForWrite", () => {
    it("drops the request org when local mode maps the owner to local", () => {
      setEnv({ NODE_ENV: "development" });
      expect(resolvePlanOrgIdForWrite("user@example.com", "org_1")).toBe(
        undefined,
      );
    });

    it("keeps the request org in hosted mode", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOrgIdForWrite("user@example.com", "org_1")).toBe(
        "org_1",
      );
    });
  });

  describe("resolvePlanOwnerEmailForWrite", () => {
    it("honors a real authenticated user (hosted)", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmailForWrite("user@example.com")).toBe(
        "user@example.com",
      );
    });

    it("uses the local identity for authenticated writes in local mode", () => {
      setEnv({ NODE_ENV: "development" });
      expect(resolvePlanOwnerEmailForWrite("user@example.com")).toBe(
        LOCAL_PLAN_OWNER_EMAIL,
      );
    });

    it("rejects the legacy hosted guest-author identity for writes", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmailForWrite(GUEST_EMAIL)).toBeUndefined();
    });

    it("falls back to the local identity in local mode", () => {
      setEnv({ NODE_ENV: "development" });
      expect(resolvePlanOwnerEmailForWrite(undefined)).toBe(
        LOCAL_PLAN_OWNER_EMAIL,
      );
    });

    it("returns undefined when hosted and unauthenticated", () => {
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
    it("throws in hosted mode with no user", () => {
      setEnv({ NODE_ENV: "production" });
      expect(() =>
        requirePlanOwnerEmailForWrite(undefined, "Creating a plan"),
      ).toThrow(/requires an authenticated user/);
    });

    it("throws for a hosted guest author", () => {
      setEnv({ NODE_ENV: "production" });
      expect(() =>
        requirePlanOwnerEmailForWrite(GUEST_EMAIL, "Creating a plan"),
      ).toThrow(/requires an authenticated user/);
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
