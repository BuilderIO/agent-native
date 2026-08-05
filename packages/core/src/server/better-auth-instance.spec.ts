import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  configureLocalSqlite,
  createCoreAuthPlugins,
  ensureGoogleAuthIdentityWithAdapter,
  getAuthSecret,
  type BetterAuthInternalAdapter,
} from "./better-auth-instance.js";
import { deriveServerSecret } from "./derived-secret.js";

describe("createCoreAuthPlugins", () => {
  it("hashes magic-link tokens at rest", () => {
    const plugins = createCoreAuthPlugins(undefined, "https://app.example.com");
    const magicLink = plugins.find((plugin) => plugin.id === "magic-link");

    expect(magicLink?.options).toMatchObject({ storeToken: "hashed" });
  });

  it("does not mount magic links for Google-only apps", () => {
    const plugins = createCoreAuthPlugins(
      { googleOnly: true },
      "https://app.example.com",
    );

    expect(plugins.some((plugin) => plugin.id === "magic-link")).toBe(false);
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

describe("ensureGoogleAuthIdentityWithAdapter", () => {
  function adapterFor(user: any = null) {
    const linkAccount = vi.fn(async () => undefined);
    const replaceUnverifiedCredentialWithGoogle = vi.fn(async () => undefined);
    const createOAuthUser = vi.fn(async () => ({
      user: { id: "google-user" },
      account: {},
    }));
    const adapter: BetterAuthInternalAdapter = {
      findUserByEmail: vi.fn(async () => user),
      linkAccount,
      createUser: vi.fn(async () => ({ id: "created-user" })),
      createOAuthUser,
      findAccountByProviderId: vi.fn(async () => null),
      replaceUnverifiedCredentialWithGoogle,
    };
    return {
      adapter,
      linkAccount,
      createOAuthUser,
      replaceUnverifiedCredentialWithGoogle,
    };
  }

  it("creates a verified canonical user and Google account", async () => {
    const { adapter, createOAuthUser } = adapterFor();

    await ensureGoogleAuthIdentityWithAdapter(adapter, {
      email: "  Owner@Example.com ",
      accountId: "google-sub-1",
      name: "Owner",
    });

    expect(createOAuthUser).toHaveBeenCalledWith(
      { email: "owner@example.com", name: "Owner", emailVerified: true },
      { providerId: "google", accountId: "google-sub-1" },
    );
  });

  it("rechecks the Google account after a concurrent create race", async () => {
    const existing = {
      user: {
        id: "existing-user",
        email: "owner@example.com",
        emailVerified: true,
      },
      accounts: [],
    };
    const { adapter, createOAuthUser, linkAccount } = adapterFor();
    vi.mocked(adapter.findUserByEmail)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    vi.mocked(adapter.findAccountByProviderId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "google-account",
        userId: "existing-user",
        providerId: "google",
        accountId: "google-sub-race",
      });
    createOAuthUser.mockRejectedValueOnce(new Error("email already exists"));

    await ensureGoogleAuthIdentityWithAdapter(adapter, {
      email: "owner@example.com",
      accountId: "google-sub-race",
    });

    expect(linkAccount).not.toHaveBeenCalled();
  });

  it("links an already verified canonical user", async () => {
    const existing = {
      user: {
        id: "existing-user",
        email: "owner@example.com",
        emailVerified: true,
      },
      accounts: [],
    };
    const { adapter, linkAccount, createOAuthUser } = adapterFor(existing);

    await ensureGoogleAuthIdentityWithAdapter(adapter, {
      email: "owner@example.com",
      accountId: "google-sub-1",
    });

    expect(linkAccount).toHaveBeenCalledWith({
      userId: "existing-user",
      providerId: "google",
      accountId: "google-sub-1",
    });
    expect(createOAuthUser).not.toHaveBeenCalled();
  });

  it("refuses to bless an unverified password identity", async () => {
    const existing = {
      user: {
        id: "existing-user",
        email: "owner@example.com",
        emailVerified: false,
      },
      accounts: [
        {
          id: "credential-account",
          providerId: "credential",
          accountId: "existing-user",
        },
      ],
    };
    const { adapter, linkAccount, replaceUnverifiedCredentialWithGoogle } =
      adapterFor(existing);

    await ensureGoogleAuthIdentityWithAdapter(adapter, {
      email: "owner@example.com",
      accountId: "google-sub-1",
    });
    expect(replaceUnverifiedCredentialWithGoogle).toHaveBeenCalledWith({
      userId: "existing-user",
      email: "owner@example.com",
      accountId: "google-sub-1",
    });
    expect(linkAccount).not.toHaveBeenCalled();
  });

  it("keeps account-claim protection for an unverified user with another account", async () => {
    const existing = {
      user: {
        id: "existing-user",
        email: "owner@example.com",
        emailVerified: false,
      },
      accounts: [
        {
          id: "credential-account",
          providerId: "credential",
          accountId: "existing-user",
        },
        {
          id: "github-account",
          providerId: "github",
          accountId: "github-sub-1",
        },
      ],
    };
    const { adapter, linkAccount, replaceUnverifiedCredentialWithGoogle } =
      adapterFor(existing);

    await expect(
      ensureGoogleAuthIdentityWithAdapter(adapter, {
        email: "owner@example.com",
        accountId: "google-sub-1",
      }),
    ).rejects.toThrow("unverified email/password identity");
    expect(replaceUnverifiedCredentialWithGoogle).not.toHaveBeenCalled();
    expect(linkAccount).not.toHaveBeenCalled();
  });
});
