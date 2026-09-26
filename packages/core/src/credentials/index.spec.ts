import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for the settings table so we can inspect what is
// persisted at rest (the whole point of this fix).
const store = new Map<string, { value: unknown }>();
const readAppSecret = vi.fn();

vi.mock("../secrets/storage.js", () => ({ readAppSecret }));

vi.mock("../settings/store.js", () => ({
  getSetting: async (key: string) => store.get(key) ?? null,
  putSetting: async (key: string, value: { value: unknown }) => {
    store.set(key, value);
  },
  deleteSetting: async (key: string) => store.delete(key),
}));

// Every call site builds ctx from `getCredentialContext()`, which never
// populates orgId for a CLI/cron run — resolveCredential falls back to
// resolving the caller's org from their email instead. Mocked here (rather
// than letting the real module run) so these stay hermetic unit tests, not an
// accidental dependency on whatever database happens to be configured.
let resolveOrgIdForEmail: (email: string) => Promise<string | null>;
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: (email: string) => resolveOrgIdForEmail(email),
}));

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "credentials-spec-key";
  store.clear();
  readAppSecret.mockReset();
  readAppSecret.mockResolvedValue(null);
  resolveOrgIdForEmail = async () => null;
});

describe("credentials encryption at rest", () => {
  it("saveCredential stores ciphertext; resolveCredential returns plaintext", async () => {
    const { saveCredential, resolveCredential } = await import("./index.js");
    await saveCredential("OPENAI_API_KEY", "sk-secret-value", {
      userEmail: "a@x.com",
    });

    const raw = store.get("u:a@x.com:credential:OPENAI_API_KEY");
    expect(typeof raw?.value).toBe("string");
    // At rest it is encrypted — the plaintext is nowhere in the row.
    expect(raw?.value as string).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(raw?.value as string).not.toContain("sk-secret-value");

    expect(
      await resolveCredential("OPENAI_API_KEY", { userEmail: "a@x.com" }),
    ).toBe("sk-secret-value");
  });

  it("reads legacy plaintext rows transparently (no migration required)", async () => {
    store.set("u:a@x.com:credential:LEGACY", { value: "plaintext-key" });
    const { resolveCredential } = await import("./index.js");
    expect(await resolveCredential("LEGACY", { userEmail: "a@x.com" })).toBe(
      "plaintext-key",
    );
  });

  it("encrypts org-scoped credentials too", async () => {
    const { saveCredential, resolveCredential } = await import("./index.js");
    await saveCredential("STRIPE_KEY", "org-secret", {
      userEmail: "a@x.com",
      orgId: "org-1",
      scope: "org",
    });
    expect(store.get("o:org-1:credential:STRIPE_KEY")?.value as string).toMatch(
      /^v1:/,
    );
    expect(
      await resolveCredential("STRIPE_KEY", {
        userEmail: "a@x.com",
        orgId: "org-1",
      }),
    ).toBe("org-secret");
  });

  it("reads org app secrets synced from the Dispatch vault", async () => {
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "org" &&
      ref.scopeId === "org-1" &&
      ref.key === "HUBSPOT_ACCESS_TOKEN"
        ? { value: "vault-hubspot-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    const { resolveCredential } = await import("./index.js");

    await expect(
      resolveCredential("HUBSPOT_ACCESS_TOKEN", {
        userEmail: "member@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBe("vault-hubspot-token");
    expect(readAppSecret.mock.calls.map(([ref]) => ref)).toEqual([
      {
        key: "HUBSPOT_ACCESS_TOKEN",
        scope: "user",
        scopeId: "member@example.test",
      },
      {
        key: "HUBSPOT_ACCESS_TOKEN",
        scope: "org",
        scopeId: "org-1",
      },
    ]);
  });

  it("retains credential scope and blocks shared credentials from user endpoints", async () => {
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "org" && ref.scopeId === "org-1"
        ? { value: "shared-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    const { assertCredentialCanReachEndpoint, resolveCredentialDetailed } =
      await import("./index.js");
    const credential = await resolveCredentialDetailed("TOKEN", {
      userEmail: "member@example.test",
      orgId: "org-1",
    });

    expect(credential).toMatchObject({
      value: "shared-token",
      scope: "org",
      scopeId: "org-1",
    });
    expect(() =>
      assertCredentialCanReachEndpoint(
        { scope: "user", scopeId: "member@example.test" },
        credential!,
        "TOKEN",
      ),
    ).toThrow(/user-controlled endpoint/i);
    expect(() =>
      assertCredentialCanReachEndpoint(
        { scope: "user", scopeId: "member@example.test" },
        {
          value: "personal-token",
          scope: "user",
          scopeId: "member@example.test",
        },
        "TOKEN",
      ),
    ).not.toThrow();
  });

  it("blocks org credentials from retained solo-workspace endpoints", async () => {
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "org" && ref.scopeId === "org-1"
        ? { value: "org-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    const {
      assertCredentialCanReachEndpoint,
      CredentialEndpointMismatchError,
      resolveCredentialDetailed,
    } = await import("./index.js");
    const endpoint = {
      scope: "workspace",
      scopeId: "solo:owner@example.test",
    };
    const orgCredential = await resolveCredentialDetailed("TOKEN", {
      userEmail: "owner@example.test",
      orgId: "org-1",
    });

    expect(orgCredential).toMatchObject({ scope: "org", scopeId: "org-1" });
    expect(() =>
      assertCredentialCanReachEndpoint(endpoint, orgCredential, "TOKEN"),
    ).toThrow(CredentialEndpointMismatchError);

    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "workspace" && ref.scopeId === endpoint.scopeId
        ? { value: "pre-org-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    const soloCredential = await resolveCredentialDetailed("TOKEN", {
      userEmail: "owner@example.test",
      orgId: "org-1",
    });

    expect(soloCredential).toMatchObject({
      scope: "workspace",
      scopeId: endpoint.scopeId,
    });
    expect(() =>
      assertCredentialCanReachEndpoint(endpoint, soloCredential, "TOKEN"),
    ).not.toThrow();
  });

  it("keeps organization-owned endpoints within the matching shared scope", async () => {
    const {
      assertCredentialCanReachEndpoint,
      CredentialEndpointMismatchError,
    } = await import("./index.js");
    const endpoint = { scope: "org", scopeId: "org-1" };

    expect(() =>
      assertCredentialCanReachEndpoint(
        endpoint,
        { scope: "user", scopeId: "member@example.test" },
        "TOKEN",
      ),
    ).toThrow(CredentialEndpointMismatchError);
    expect(() =>
      assertCredentialCanReachEndpoint(
        endpoint,
        { scope: "org", scopeId: "org-2" },
        "TOKEN",
      ),
    ).toThrow(CredentialEndpointMismatchError);
    expect(() =>
      assertCredentialCanReachEndpoint(
        endpoint,
        { scope: "workspace", scopeId: "org-1" },
        "TOKEN",
      ),
    ).not.toThrow();
  });

  it("does not combine credentials from different workspace connections", async () => {
    const {
      assertCredentialCanReachEndpoint,
      CredentialEndpointMismatchError,
    } = await import("./index.js");
    const endpoint = {
      scope: "org",
      scopeId: "org-1",
      source: "workspace_connection",
      connectionId: "conn-a",
    };

    expect(() =>
      assertCredentialCanReachEndpoint(
        endpoint,
        {
          scope: "org",
          scopeId: "org-1",
          source: "workspace_connection",
          connectionId: "conn-b",
        },
        "TOKEN",
      ),
    ).toThrow(CredentialEndpointMismatchError);
    expect(() =>
      assertCredentialCanReachEndpoint(
        endpoint,
        {
          scope: "org",
          scopeId: "org-1",
          source: "workspace_connection",
          connectionId: "conn-a",
        },
        "TOKEN",
      ),
    ).not.toThrow();
  });

  it("checks credential scope even when the endpoint and credential share a workspace connection", async () => {
    const {
      assertCredentialCanReachEndpoint,
      CredentialEndpointMismatchError,
    } = await import("./index.js");
    const endpoint = {
      scope: "user",
      scopeId: "member@example.test",
      source: "workspace_connection",
      connectionId: "conn-a",
    };

    expect(() =>
      assertCredentialCanReachEndpoint(
        endpoint,
        {
          scope: "org",
          scopeId: "org-1",
          source: "workspace_connection",
          connectionId: "conn-a",
        },
        "TOKEN",
      ),
    ).toThrow(CredentialEndpointMismatchError);
    expect(() =>
      assertCredentialCanReachEndpoint(
        endpoint,
        {
          scope: "user",
          scopeId: "member@example.test",
          source: "workspace_connection",
          connectionId: "conn-a",
        },
        "TOKEN",
      ),
    ).not.toThrow();
  });

  it("reads solo workspace app secrets when there is no active org", async () => {
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "workspace" && ref.scopeId === "solo:owner@example.test"
        ? { value: "solo-vault-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    const { resolveCredential } = await import("./index.js");

    await expect(
      resolveCredential("GONG_ACCESS_KEY", {
        userEmail: "owner@example.test",
      }),
    ).resolves.toBe("solo-vault-token");
  });

  it("finds an org-scoped credential from the caller's email when ctx.orgId is unset, like a CLI or cron run", async () => {
    resolveOrgIdForEmail = async () => "org-1";
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "org" && ref.scopeId === "org-1"
        ? { value: "org-secret-via-email", last4: "oken", updatedAt: 1 }
        : null,
    );
    const { resolveCredential } = await import("./index.js");

    // No orgId on ctx — the caller never populated one (CLI/agent.ts,
    // background-automation-runner.ts). Interactively the same key resolves
    // fine because a session backfills orgId; this proves a non-interactive
    // caller now reaches the same org-scoped row instead of silently missing.
    await expect(
      resolveCredential("BIGQUERY_SERVICE_ACCOUNT", {
        userEmail: "owner@example.test",
      }),
    ).resolves.toBe("org-secret-via-email");
  });

  it("throws instead of silently reporting 'not configured' when org membership is unreadable", async () => {
    resolveOrgIdForEmail = async () => {
      throw Object.assign(new Error("db connect timed out"), {
        code: "ETIMEDOUT",
      });
    };
    const { resolveCredential } = await import("./index.js");

    // "The store didn't answer" must not collapse into the same undefined a
    // truly-unset credential returns — the caller needs to retry, not be told
    // to go configure something that is already saved.
    await expect(
      resolveCredential("BIGQUERY_SERVICE_ACCOUNT", {
        userEmail: "owner@example.test",
      }),
    ).rejects.toThrow(/could not read/i);
  });

  it("still finds a pre-org solo workspace secret once the user has an org", async () => {
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "workspace" && ref.scopeId === "solo:owner@example.test"
        ? { value: "pre-org-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    const { resolveCredential } = await import("./index.js");

    await expect(
      resolveCredential("GONG_ACCESS_KEY", {
        userEmail: "owner@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBe("pre-org-token");
    expect(readAppSecret.mock.calls.map(([ref]) => ref)).toEqual([
      { key: "GONG_ACCESS_KEY", scope: "user", scopeId: "owner@example.test" },
      { key: "GONG_ACCESS_KEY", scope: "org", scopeId: "org-1" },
      { key: "GONG_ACCESS_KEY", scope: "workspace", scopeId: "org-1" },
      {
        key: "GONG_ACCESS_KEY",
        scope: "workspace",
        scopeId: "solo:owner@example.test",
      },
    ]);
  });

  it("prefers the current org-scoped secret over a stale pre-org solo one", async () => {
    readAppSecret.mockImplementation(async (ref: any) => {
      if (ref.scope === "org" && ref.scopeId === "org-1") {
        return { value: "current-org-token", last4: "oken", updatedAt: 2 };
      }
      if (
        ref.scope === "workspace" &&
        ref.scopeId === "solo:owner@example.test"
      ) {
        return { value: "stale-pre-org-token", last4: "oken", updatedAt: 1 };
      }
      return null;
    });
    const { resolveCredential } = await import("./index.js");

    await expect(
      resolveCredential("GONG_ACCESS_KEY", {
        userEmail: "owner@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBe("current-org-token");
  });

  it("prefers the org-scoped legacy setting over the pre-org solo secret", async () => {
    store.set("o:org-1:credential:GONG_ACCESS_KEY", {
      value: "org-legacy-token",
    });
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "workspace" && ref.scopeId === "solo:owner@example.test"
        ? { value: "stale-pre-org-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    const { resolveCredential } = await import("./index.js");

    await expect(
      resolveCredential("GONG_ACCESS_KEY", {
        userEmail: "owner@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBe("org-legacy-token");
  });

  it("keeps a legacy user override ahead of shared app secrets", async () => {
    store.set("u:member@example.test:credential:STRIPE_KEY", {
      value: "personal-legacy-token",
    });
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "org"
        ? { value: "shared-org-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    const { resolveCredential } = await import("./index.js");

    await expect(
      resolveCredential("STRIPE_KEY", {
        userEmail: "member@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBe("personal-legacy-token");
    expect(readAppSecret).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when the encryption key rotated (cannot decrypt)", async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "key-A";
    const { saveCredential, resolveCredential } = await import("./index.js");
    await saveCredential("ROTATED", "v", { userEmail: "a@x.com" });
    // Key rotation — the stored ciphertext can no longer be decrypted.
    process.env.SECRETS_ENCRYPTION_KEY = "key-B";
    expect(
      await resolveCredential("ROTATED", { userEmail: "a@x.com" }),
    ).toBeUndefined();
  });

  it("round-trips through delete", async () => {
    const { saveCredential, resolveCredential, deleteCredential } =
      await import("./index.js");
    await saveCredential("K", "v", { userEmail: "a@x.com" });
    await deleteCredential("K", { userEmail: "a@x.com" });
    expect(
      await resolveCredential("K", { userEmail: "a@x.com" }),
    ).toBeUndefined();
  });
});
