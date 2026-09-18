/**
 * Adversarial / edge-case coverage for local-identity.ts.
 *
 * The existing local-identity.spec.ts covers the documented happy paths. This
 * file attacks the *boundaries* of the security contract:
 *
 *   - The production refusal is the ONLY barrier between an unauthenticated
 *     request and the LOCAL_PLAN_OWNER_EMAIL write identity. We probe whether a
 *     misconfigured NODE_ENV value can slip past it.
 *   - AUTH_MODE / PLAN_LOCAL_MODE parsing edge cases (case, whitespace, near
 *     values) that decide whether the no-login local owner activates.
 *   - The synthetic-identity regexes (`isGuestAuthorIdentity`,
 *     `isAnonymousPublicViewer`) must not be tricked into mis-classifying a real
 *     account as synthetic (or vice-versa), since several callers gate on them.
 */
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

const ENV_KEYS = [
  "NODE_ENV",
  "AUTH_MODE",
  "PLAN_LOCAL_MODE",
  "PLAN_LOCAL_OWNER_EMAIL",
] as const;

describe("local-identity adversarial", () => {
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

  describe("production refusal robustness (auth-bypass surface)", () => {
    it("refuses local mode for the canonical NODE_ENV=production", () => {
      setEnv({ NODE_ENV: "production" });
      expect(isLocalPlanRuntime()).toBe(false);
      // And therefore an unauthenticated WRITE has no owner.
      expect(resolvePlanOwnerEmailForWrite(undefined)).toBeUndefined();
    });

    // CONTRACT INTENT: the documented promise in local-identity.ts is "the
    // local-mode fallback can NEVER activate on a hosted deploy". A hosted box
    // that sets NODE_ENV with a different *case* ("Production" / "PRODUCTION")
    // — a real, easy misconfiguration — must still refuse local mode, otherwise
    // an unauthenticated request silently becomes the single local owner and
    // can create/read/edit plans with no login.
    //
    // This test PINS the desired contract. It currently FAILS because the guard
    // does an exact `=== "production"` comparison and never normalizes case, so
    // any non-lowercase value falls through to "local mode on".
    it("refuses local mode even when NODE_ENV case differs (Production / PRODUCTION)", () => {
      for (const value of ["Production", "PRODUCTION", "Prod", " production"]) {
        setEnv({ NODE_ENV: value });
        expect(
          isLocalPlanRuntime(),
          `NODE_ENV=${JSON.stringify(value)} must not enable local mode`,
        ).toBe(false);
      }
    });
  });

  describe("AUTH_MODE parsing (fail-closed direction is safe)", () => {
    it("treats a non-lowercase AUTH_MODE=LOCAL as a NON-local (real) auth mode", () => {
      // Fail-closed: uppercase is not the recognized "local" shim, so we must
      // NOT assume a single local user. (Refusing is the safe direction.)
      setEnv({ NODE_ENV: "development", AUTH_MODE: "LOCAL" });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("treats AUTH_MODE with surrounding whitespace as non-local (fail-closed)", () => {
      setEnv({ NODE_ENV: "development", AUTH_MODE: " local " });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("treats any unknown AUTH_MODE (e.g. hosted/admin/empty-ish) as non-local", () => {
      for (const mode of ["hosted", "admin", "oauth", "saml"]) {
        setEnv({ NODE_ENV: "development", AUTH_MODE: mode });
        expect(isLocalPlanRuntime(), `AUTH_MODE=${mode}`).toBe(false);
      }
    });

    it("an explicit empty AUTH_MODE behaves like unset (local mode on in dev)", () => {
      setEnv({ NODE_ENV: "development", AUTH_MODE: "" });
      expect(isLocalPlanRuntime()).toBe(true);
    });
  });

  describe("PLAN_LOCAL_MODE flag precedence", () => {
    it("PLAN_LOCAL_MODE=0 opt-out wins over AUTH_MODE=local in dev", () => {
      setEnv({
        NODE_ENV: "development",
        AUTH_MODE: "local",
        PLAN_LOCAL_MODE: "0",
      });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("PLAN_LOCAL_MODE=0 opt-out CANNOT override the production refusal (already false there)", () => {
      setEnv({ NODE_ENV: "production", PLAN_LOCAL_MODE: "0" });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("PLAN_LOCAL_MODE=1 CANNOT override the production refusal", () => {
      setEnv({ NODE_ENV: "production", PLAN_LOCAL_MODE: "1" });
      expect(isLocalPlanRuntime()).toBe(false);
    });

    it("PLAN_LOCAL_OWNER_EMAIL CANNOT override the production refusal", () => {
      setEnv({
        NODE_ENV: "production",
        PLAN_LOCAL_MODE: "1",
        PLAN_LOCAL_OWNER_EMAIL: "owner@example.com",
      });
      expect(isLocalPlanRuntime()).toBe(false);
      expect(resolvePlanOwnerEmail(undefined)).toBeUndefined();
      expect(resolvePlanOwnerEmailForWrite(undefined)).toBeUndefined();
    });

    it("only the exact string '0' opts out — '00'/'false'/'no' do NOT (they enable local in dev)", () => {
      // Documents the brittle parsing: anything other than exactly "0" is not an
      // opt-out, so it falls through to the default (local on, in dev).
      for (const value of ["00", "false", "no", " 0", "0 "]) {
        setEnv({ NODE_ENV: "development", PLAN_LOCAL_MODE: value });
        expect(isLocalPlanRuntime(), `PLAN_LOCAL_MODE=${value}`).toBe(true);
      }
    });
  });

  describe("resolve/require helpers under hostile inputs", () => {
    it("an empty-string authenticated email is treated as falsy → falls back to local in dev", () => {
      setEnv({ NODE_ENV: "development" });
      expect(resolvePlanOwnerEmail("")).toBe(LOCAL_PLAN_OWNER_EMAIL);
      expect(resolvePlanOwnerEmailForWrite("")).toBe(LOCAL_PLAN_OWNER_EMAIL);
    });

    it("an empty-string authenticated email in production yields NO owner (rejects)", () => {
      setEnv({ NODE_ENV: "production" });
      expect(resolvePlanOwnerEmail("")).toBeUndefined();
      expect(resolvePlanOwnerEmailForWrite("")).toBeUndefined();
      expect(() =>
        requirePlanOwnerEmailForWrite("", "Creating a plan"),
      ).toThrow(/requires an authenticated user/);
    });

    it("a public-VIEWER identity passed to the WRITE resolver is honored as-is (not upgraded), so editor checks still gate it", () => {
      // resolvePlanOwnerEmailForWrite does NOT special-case the public viewer;
      // it returns it unchanged. The real write protection is the downstream
      // assertPlanEditor / comment gate, NOT this resolver. This documents that
      // the resolver itself is not a write gate for public viewers.
      setEnv({ NODE_ENV: "production" });
      const viewer =
        "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local";
      expect(resolvePlanOwnerEmailForWrite(viewer)).toBe(viewer);
    });

    it("a guest-author identity is rejected for writes in production (no owner)", () => {
      setEnv({ NODE_ENV: "production" });
      const guest = `guest-123e4567-e89b-12d3-a456-426614174000@${GUEST_AUTHOR_DOMAIN}`;
      expect(resolvePlanOwnerEmailForWrite(guest)).toBeUndefined();
      expect(() =>
        requirePlanOwnerEmailForWrite(guest, "Creating a plan"),
      ).toThrow(/requires an authenticated user/);
    });

    it("a guest-author identity in LOCAL dev falls back to the local owner (not the guest)", () => {
      setEnv({ NODE_ENV: "development" });
      const guest = `guest-123e4567-e89b-12d3-a456-426614174000@${GUEST_AUTHOR_DOMAIN}`;
      // Guest is rejected, but local mode supplies the local owner instead.
      expect(resolvePlanOwnerEmailForWrite(guest)).toBe(LOCAL_PLAN_OWNER_EMAIL);
    });
  });

  describe("synthetic identity classifier hardening", () => {
    it("does not classify a real account whose local-part merely starts with 'guest-' as a guest", () => {
      // Real account on a real domain must never be treated as a synthetic guest.
      expect(isGuestAuthorIdentity("guest-relations@example.com")).toBe(false);
      expect(isGuestAuthorIdentity("guest-team@agent-native.com")).toBe(false);
    });

    it("does not classify a real account on the local/public domain as a public viewer", () => {
      expect(isAnonymousPublicViewer("publicist@agent-native.local")).toBe(
        false,
      );
      // "public-relations" lacks the uuid+exact-domain shape.
      expect(isAnonymousPublicViewer("public-relations@example.com")).toBe(
        false,
      );
    });

    it("rejects a guest-shaped local-part on the WRONG domain", () => {
      // Same local-part, attacker-controlled domain — must not be a guest id.
      expect(
        isGuestAuthorIdentity(
          "guest-123e4567-e89b-12d3-a456-426614174000@evil.com",
        ),
      ).toBe(false);
    });

    it("rejects a public-viewer-shaped local-part on the WRONG domain", () => {
      expect(
        isAnonymousPublicViewer(
          "public-123e4567-e89b-12d3-a456-426614174000@evil.com",
        ),
      ).toBe(false);
    });

    it("is anchored — no embedded-identity match via leading/trailing junk or newlines", () => {
      const guest =
        "guest-123e4567-e89b-12d3-a456-426614174000@agent-native.guest";
      const pub =
        "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local";
      for (const wrap of [
        `x${guest}`,
        `${guest}x`,
        `${guest}\nattacker@example.com`,
        `attacker@example.com\n${guest}`,
        ` ${guest}`,
      ]) {
        expect(
          isGuestAuthorIdentity(wrap),
          `guest wrap: ${JSON.stringify(wrap)}`,
        ).toBe(false);
      }
      for (const wrap of [
        `x${pub}`,
        `${pub}x`,
        `${pub}\nattacker@example.com`,
        `attacker@example.com\n${pub}`,
        ` ${pub}`,
      ]) {
        expect(
          isAnonymousPublicViewer(wrap),
          `pub wrap: ${JSON.stringify(wrap)}`,
        ).toBe(false);
      }
    });

    it("accepts case-insensitive domain casing for synthetic ids (matches /i regex)", () => {
      expect(
        isGuestAuthorIdentity(
          "guest-123e4567-e89b-12d3-a456-426614174000@AGENT-NATIVE.GUEST",
        ),
      ).toBe(true);
      expect(
        isAnonymousPublicViewer(
          "public-123e4567-e89b-12d3-a456-426614174000@Agent-Native.Local",
        ),
      ).toBe(true);
    });
  });
});
