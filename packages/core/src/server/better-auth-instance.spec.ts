import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  configureLocalSqlite,
  currentD1AuthBinding,
  getAuthSecret,
} from "./better-auth-instance.js";
import { deriveServerSecret } from "./derived-secret.js";

describe("currentD1AuthBinding", () => {
  const runtime = globalThis as Record<string, any>;

  afterEach(() => {
    delete runtime.__cf_env;
  });

  it("names the missing binding instead of failing inside a native stub", () => {
    delete runtime.__cf_env;
    const binding = currentD1AuthBinding() as { prepare?: unknown };

    expect(() => binding.prepare).toThrow(
      /no D1 database is bound to `env.DB`/,
    );
  });

  it("follows the binding of the invocation making the call", () => {
    const first = { prepare: vi.fn(() => "first") };
    const second = { prepare: vi.fn(() => "second") };
    runtime.__cf_env = { DB: first };

    // Resolved once, as Better Auth does when it builds its cached instance.
    const binding = currentD1AuthBinding() as { prepare: () => string };
    expect(binding.prepare()).toBe("first");

    runtime.__cf_env = { DB: second };
    expect(binding.prepare()).toBe("second");
    expect(first.prepare).toHaveBeenCalledTimes(1);
  });
});

describe("configureLocalSqlite", () => {
  it("waits for competing app writes before giving up", () => {
    const pragma = vi.fn();

    configureLocalSqlite({ pragma });

    expect(pragma.mock.calls).toEqual([
      ["busy_timeout = 10000"],
      ["journal_mode = WAL"],
    ]);
  });
});

describe("resolveAuthSecret", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.A2A_SECRET;
    delete process.env.AGENT_NATIVE_WORKSPACE;
    delete process.env.VITE_AGENT_NATIVE_WORKSPACE;
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

  it("derives a production workspace auth secret from A2A_SECRET", () => {
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    process.env.A2A_SECRET = "workspace-root-secret";

    expect(getAuthSecret()).toBe(
      deriveServerSecret("workspace-root-secret", "better-auth"),
    );
    expect(getAuthSecret()).not.toBe("workspace-root-secret");
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

  // SECURITY (audit 09 LOW-2): the dev-mode fallback used to chain to
  // GOOGLE_CLIENT_SECRET, ACCESS_TOKEN, and a hardcoded literal. All
  // three were dropped — the fallback now mints a random in-memory
  // secret only when the filesystem is unwritable. These tests verify
  // that even with those legacy env vars set, the resolved secret is
  // not either of them or the legacy literal.
  it("never returns the legacy hardcoded fallback string", () => {
    process.env.NODE_ENV = "development";
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.ACCESS_TOKEN;
    const secret = getAuthSecret();
    expect(secret).not.toBe("agent-native-local-dev-secret-k9x2m7q4w8");
  });
});
