import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markServerRuntimeStarted } from "../db/server-runtime.js";
import {
  acceptsUnsignedSelfDispatch,
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
  isTrustedLocalRequest,
  shouldAdvertiseJwtA2AAuth,
} from "./auth-policy.js";

const loopbackMocks = vi.hoisted(() => ({
  isLoopbackRequest: vi.fn((_event: H3Event) => false),
  isLoopbackTrustedEnvironment: vi.fn(() => true),
}));

vi.mock("../server/loopback.js", async (importActual) => ({
  ...(await importActual<typeof import("../server/loopback.js")>()),
  ...loopbackMocks,
}));

const event = {} as H3Event;

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
  "AGENT_NATIVE_BUILD_PRODUCTION_SERVER",
  "NETLIFY_FUNCTION_NAME",
  "LAMBDA_TASK_ROOT",
  "AWS_EXECUTION_ENV",
  "AWS_SAM_LOCAL",
  "VERCEL_FUNCTION_ID",
  "VERCEL_REGION",
] as const;

describe("a2a auth-policy", () => {
  const originalEnv = { ...process.env };
  const hadCfEnv = "__cf_env" in globalThis;

  beforeEach(() => {
    for (const key of A2A_ENV_KEYS) delete process.env[key];
    delete (globalThis as Record<string, unknown>).__cf_env;
    delete (globalThis as Record<string, unknown>)
      .__AGENT_NATIVE_SERVER_RUNTIME__;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete (globalThis as Record<string, unknown>)
      .__AGENT_NATIVE_SERVER_RUNTIME__;
    if (hadCfEnv) {
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

    it("treats a started production server build as production without NODE_ENV", () => {
      process.env.AGENT_NATIVE_BUILD_PRODUCTION_SERVER = "true";
      markServerRuntimeStarted();
      expect(isA2AProductionRuntime()).toBe(true);
    });

    it.each([
      ["NETLIFY_FUNCTION_NAME", "server"],
      ["LAMBDA_TASK_ROOT", "/var/task"],
      ["VERCEL_FUNCTION_ID", "fn_1"],
      ["VERCEL_REGION", "iad1"],
    ])(
      "treats a hosted invocation marked only by %s as production",
      (key, value) => {
        process.env[key] = value;
        expect(isA2AProductionRuntime()).toBe(true);
      },
    );

    it.each([
      [
        "netlify serve of the production build",
        { NETLIFY_LOCAL: "true", NETLIFY_FUNCTION_NAME: "server" },
      ],
      [
        "vercel dev",
        { VERCEL: "1", VERCEL_ENV: "development", VERCEL_REGION: "dev1" },
      ],
      [
        "sam local",
        { AWS_SAM_LOCAL: "true", AWS_LAMBDA_FUNCTION_NAME: "my-func" },
      ],
    ])(
      "does NOT treat %s as production, even with NODE_ENV production",
      (_case, env: Record<string, string>) => {
        Object.assign(process.env, env, {
          NODE_ENV: "production",
          AGENT_NATIVE_BUILD_PRODUCTION_SERVER: "true",
        });
        markServerRuntimeStarted();
        expect(isA2AProductionRuntime()).toBe(false);
      },
    );

    it("does not treat a production build that is not serving as production", () => {
      process.env.AGENT_NATIVE_BUILD_PRODUCTION_SERVER = "true";
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

  describe("isTrustedLocalRequest", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
      loopbackMocks.isLoopbackRequest.mockReset().mockReturnValue(false);
    });

    it("is false on a production runtime even for a local request", () => {
      process.env.NODE_ENV = "production";
      loopbackMocks.isLoopbackRequest.mockReturnValue(true);
      expect(isTrustedLocalRequest(event)).toBe(false);
    });

    it("is true for a local request in dev", () => {
      loopbackMocks.isLoopbackRequest.mockReturnValue(true);
      expect(isTrustedLocalRequest(event)).toBe(true);
      expect(loopbackMocks.isLoopbackRequest).toHaveBeenCalledWith(event);
    });

    it("is false for a request that is not local, with no opt-in", () => {
      expect(isTrustedLocalRequest(event)).toBe(false);
    });

    it("is false without an inbound event", () => {
      expect(isTrustedLocalRequest(undefined)).toBe(false);
    });

    it("is true for a non-local request when the explicit opt-in flag is set", () => {
      process.env.A2A_ALLOW_UNSIGNED_INTERNAL = "1";
      expect(isTrustedLocalRequest(event)).toBe(true);
    });

    it("is false on a recognized cloud host even for a local request", () => {
      process.env.NETLIFY = "true";
      loopbackMocks.isLoopbackRequest.mockReturnValue(true);
      expect(isTrustedLocalRequest(event)).toBe(false);
    });
  });

  describe("acceptsUnsignedSelfDispatch", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
      loopbackMocks.isLoopbackTrustedEnvironment
        .mockReset()
        .mockReturnValue(true);
    });

    it.each([
      "http://localhost:8080",
      "http://127.0.0.1:3000/docs",
      "http://[::1]:3000",
    ])("accepts a handoff to %s in local dev", (url) => {
      expect(acceptsUnsignedSelfDispatch(url)).toBe(true);
    });

    it.each([
      "https://abc.ngrok.app",
      "http://192.168.1.20:3000",
      "http://0.0.0.0:3000",
      "not a url",
    ])("refuses a handoff to %s", (url) => {
      expect(acceptsUnsignedSelfDispatch(url)).toBe(false);
    });

    it("refuses a loopback handoff in a public dev container", () => {
      loopbackMocks.isLoopbackTrustedEnvironment.mockReturnValue(false);
      expect(acceptsUnsignedSelfDispatch("http://localhost:8080")).toBe(false);
    });

    it("refuses on a production runtime", () => {
      process.env.NODE_ENV = "production";
      expect(acceptsUnsignedSelfDispatch("http://localhost:8080")).toBe(false);
    });

    it("accepts any handoff when the explicit opt-in flag is set", () => {
      process.env.A2A_ALLOW_UNSIGNED_INTERNAL = "1";
      expect(acceptsUnsignedSelfDispatch("https://abc.ngrok.app")).toBe(true);
    });
  });
});
