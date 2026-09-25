import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
  isLoopbackAddress,
  isTrustedLocalRuntime,
  shouldAdvertiseJwtA2AAuth,
} from "./auth-policy.js";

// Env vars these helpers read. Cleared before each test so the host machine's
// real environment (NODE_ENV, CI provider flags, etc.) can't make a "default"
// case secretly pass.
const A2A_ENV_KEYS = [
  "NODE_ENV",
  "NETLIFY",
  "NETLIFY_LOCAL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "CF_PAGES",
  "VERCEL",
  "VERCEL_ENV",
  "RENDER",
  "FLY_APP_NAME",
  "K_SERVICE",
  "A2A_SECRET",
  "A2A_ALLOW_UNSIGNED_INTERNAL",
] as const;

describe("a2a auth-policy", () => {
  const originalEnv = { ...process.env };
  const hadCfEnv = "__cf_env" in globalThis;

  beforeEach(() => {
    for (const key of A2A_ENV_KEYS) delete process.env[key];
    delete (globalThis as Record<string, unknown>).__cf_env;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (hadCfEnv) {
      // restore whatever was there; tests never set a meaningful value
      (globalThis as Record<string, unknown>).__cf_env ??= {};
    } else {
      delete (globalThis as Record<string, unknown>).__cf_env;
    }
  });

  describe("isA2AProductionRuntime", () => {
    it("is false with no production signals", () => {
      expect(isA2AProductionRuntime()).toBe(false);
    });

    it("is true when NODE_ENV is production", () => {
      process.env.NODE_ENV = "production";
      expect(isA2AProductionRuntime()).toBe(true);
    });

    it("is false in development/test even with no platform flags", () => {
      process.env.NODE_ENV = "development";
      expect(isA2AProductionRuntime()).toBe(false);
    });

    it("treats deployed Netlify as production", () => {
      process.env.NETLIFY = "true";
      expect(isA2AProductionRuntime()).toBe(true);
    });

    it("does NOT treat local Netlify dev (`netlify dev`) as production", () => {
      process.env.NETLIFY = "true";
      process.env.NETLIFY_LOCAL = "true";
      expect(isA2AProductionRuntime()).toBe(false);
    });

    it("requires NETLIFY to equal the literal string 'true'", () => {
      process.env.NETLIFY = "1";
      expect(isA2AProductionRuntime()).toBe(false);
    });

    it("treats a deployed Lambda function as production", () => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = "my-func";
      expect(isA2AProductionRuntime()).toBe(true);
    });

    it("does NOT treat a Lambda under local Netlify dev as production", () => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = "my-func";
      process.env.NETLIFY_LOCAL = "true";
      expect(isA2AProductionRuntime()).toBe(false);
    });

    it("treats Cloudflare Pages as production", () => {
      process.env.CF_PAGES = "1";
      expect(isA2AProductionRuntime()).toBe(true);
    });

    it("requires CF_PAGES to equal the literal string '1'", () => {
      process.env.CF_PAGES = "true";
      expect(isA2AProductionRuntime()).toBe(false);
    });

    it("treats a Cloudflare Workers binding (__cf_env on globalThis) as production", () => {
      (globalThis as Record<string, unknown>).__cf_env = {};
      expect(isA2AProductionRuntime()).toBe(true);
    });

    it("treats Vercel as production (VERCEL flag)", () => {
      process.env.VERCEL = "1";
      expect(isA2AProductionRuntime()).toBe(true);
    });

    it("treats Vercel as production (VERCEL_ENV flag)", () => {
      process.env.VERCEL_ENV = "preview";
      expect(isA2AProductionRuntime()).toBe(true);
    });

    it.each(["RENDER", "FLY_APP_NAME", "K_SERVICE"])(
      "treats %s as a production host",
      (key) => {
        process.env[key] = "set";
        expect(isA2AProductionRuntime()).toBe(true);
      },
    );
  });

  describe("hasConfiguredA2ASecret", () => {
    it("is false when A2A_SECRET is unset", () => {
      expect(hasConfiguredA2ASecret()).toBe(false);
    });

    it("is false when A2A_SECRET is empty or whitespace-only", () => {
      process.env.A2A_SECRET = "   ";
      expect(hasConfiguredA2ASecret()).toBe(false);
    });

    it("is true when A2A_SECRET holds a real value", () => {
      process.env.A2A_SECRET = "super-secret";
      expect(hasConfiguredA2ASecret()).toBe(true);
    });
  });

  describe("shouldAdvertiseJwtA2AAuth", () => {
    it("advertises JWT auth when a secret is configured even in dev", () => {
      process.env.NODE_ENV = "development";
      process.env.A2A_SECRET = "super-secret";
      expect(shouldAdvertiseJwtA2AAuth()).toBe(true);
    });

    it("advertises JWT auth in production even without a configured secret", () => {
      process.env.NODE_ENV = "production";
      expect(shouldAdvertiseJwtA2AAuth()).toBe(true);
    });

    it("does NOT advertise JWT auth in local dev with no secret", () => {
      process.env.NODE_ENV = "development";
      expect(shouldAdvertiseJwtA2AAuth()).toBe(false);
    });
  });

  describe("isTrustedLocalRuntime", () => {
    it("is false on a production runtime even when loopback", () => {
      process.env.NODE_ENV = "production";
      expect(isTrustedLocalRuntime({ loopback: true })).toBe(false);
    });

    it("is true with no secret, loopback true, dev", () => {
      process.env.NODE_ENV = "development";
      expect(isTrustedLocalRuntime({ loopback: true })).toBe(true);
    });

    it("is false with no secret, loopback false, no flag, dev (the VPS hole is now closed)", () => {
      process.env.NODE_ENV = "development";
      expect(isTrustedLocalRuntime({ loopback: false })).toBe(false);
    });

    it("is true with no secret, loopback false, when the explicit opt-in flag is set", () => {
      process.env.A2A_ALLOW_UNSIGNED_INTERNAL = "1";
      expect(isTrustedLocalRuntime({ loopback: false })).toBe(true);
    });

    it("is false on a recognized cloud host regardless of loopback", () => {
      process.env.NETLIFY = "true";
      expect(isTrustedLocalRuntime({ loopback: true })).toBe(false);
    });
  });

  describe("isLoopbackAddress", () => {
    it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.5"])(
      "treats %s as loopback",
      (addr) => {
        expect(isLoopbackAddress(addr)).toBe(true);
      },
    );

    it.each([undefined, "", "10.0.0.4", "example.com"])(
      "does NOT treat %s as loopback",
      (addr) => {
        expect(isLoopbackAddress(addr)).toBe(false);
      },
    );
  });
});
