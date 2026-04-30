import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAuthSecret } from "./better-auth-instance.js";

describe("resolveAuthSecret", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("returns the env var when set", () => {
    process.env.BETTER_AUTH_SECRET = "explicit-secret";
    expect(getAuthSecret()).toBe("explicit-secret");
  });

  it("throws in production when BETTER_AUTH_SECRET is missing", () => {
    process.env.NODE_ENV = "production";
    expect(() => getAuthSecret()).toThrow(/BETTER_AUTH_SECRET is not set/);
  });

  it("includes a sample value and openssl command in the prod error", () => {
    process.env.NODE_ENV = "production";
    expect(() => getAuthSecret()).toThrow(/openssl rand -hex 32/);
  });

  it("does not throw in dev when missing (auto-generates instead)", () => {
    process.env.NODE_ENV = "development";
    expect(() => getAuthSecret()).not.toThrow();
    expect(getAuthSecret()).toBeTruthy();
  });
});
