import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, { value: unknown }>();
const readAppSecret = vi.fn();
const deleteAppSecret = vi.fn();

vi.mock("../secrets/storage.js", () => ({ readAppSecret, deleteAppSecret }));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async (key: string) => store.get(key) ?? null,
  putSetting: async (key: string, value: { value: unknown }) => {
    store.set(key, value);
  },
  deleteSetting: async (key: string) => store.delete(key),
}));

let resolveOrgIdForEmail: (email: string) => Promise<string | null>;
const readOrgMemberRole = vi.fn();
vi.mock(
  "../server/personal-provider-key-policy.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/personal-provider-key-policy.js")
    >()),
    readOrgMemberRole: (...args: unknown[]) => readOrgMemberRole(...args),
  }),
);
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: (email: string) => resolveOrgIdForEmail(email),
}));

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "credentials-spec-key";
  store.clear();
  readAppSecret.mockReset();
  readAppSecret.mockResolvedValue(null);
  deleteAppSecret.mockReset();
  resolveOrgIdForEmail = async () => null;
  readOrgMemberRole.mockReset();
  readOrgMemberRole.mockResolvedValue("member");
});

describe("credentials encryption at rest", () => {
  it("saveCredential stores ciphertext; resolveCredential returns plaintext", async () => {
    const { saveCredential, resolveCredential } = await import("./index.js");
    await saveCredential("OPENAI_API_KEY", "sk-secret-value", {
      userEmail: "a@x.com",
    });

    const raw = store.get("u:a@x.com:credential:OPENAI_API_KEY");
    expect(typeof raw?.value).toBe("string");
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

  it("uses only the target org's credentials for org-scoped reads", async () => {
    store.set("u:admin@example.test:credential:TOKEN", {
      value: "personal-token",
    });
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "org" && ref.scopeId === "customer-org"
        ? { value: "customer-token", last4: "oken", updatedAt: 1 }
        : ref.scope === "user"
          ? { value: "personal-app-secret", last4: "cret", updatedAt: 1 }
          : null,
    );
    const { resolveCredential } = await import("./index.js");

    await expect(
      resolveCredential("TOKEN", {
        userEmail: "admin@example.test",
        orgId: "customer-org",
        credentialScope: "org",
      }),
    ).resolves.toBe("customer-token");
    expect(readAppSecret.mock.calls.map(([ref]) => ref.scope)).toEqual(["org"]);

    readAppSecret.mockClear();
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "workspace" && ref.scopeId === "solo:admin@example.test"
        ? { value: "solo-personal-token", last4: "oken", updatedAt: 1 }
        : null,
    );
    await expect(
      resolveCredential("TOKEN", {
        userEmail: "admin@example.test",
        orgId: "customer-org",
        credentialScope: "org",
      }),
    ).resolves.toBeUndefined();
    expect(readAppSecret.mock.calls.map(([ref]) => ref)).toEqual([
      { key: "TOKEN", scope: "org", scopeId: "customer-org" },
      { key: "TOKEN", scope: "workspace", scopeId: "customer-org" },
    ]);
  });

  it("fails closed when org-only credential scope has no target org", async () => {
    readAppSecret.mockResolvedValue({
      value: "personal-app-secret",
      last4: "cret",
      updatedAt: 1,
    });
    const { resolveCredential } = await import("./index.js");

    await expect(
      resolveCredential("TOKEN", {
        userEmail: "admin@example.test",
        credentialScope: "org",
      }),
    ).resolves.toBeUndefined();
    expect(readAppSecret).not.toHaveBeenCalled();
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

  it("requires credentials for workspace connection endpoints to carry that connection id", async () => {
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
          source: "oauth_token",
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
          source: "oauth_token",
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
          source: "oauth_token",
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

  it("throws instead of answering with the caller's personal key when org membership is unreadable", async () => {
    resolveOrgIdForEmail = async () => {
      throw Object.assign(new Error("db connect timed out"), {
        code: "ETIMEDOUT",
      });
    };
    readAppSecret.mockImplementation(async (ref: any) =>
      ref.scope === "user" && ref.scopeId === "owner@example.test"
        ? { value: "personal-placeholder", last4: "lder", updatedAt: 1 }
        : null,
    );
    const { resolveCredential } = await import("./index.js");

    // Without the org the caller's role is unknown: an owner must not quietly
    // run on the personal key the organization's is meant to replace.
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

  it("puts the org's credential ahead of an owner's or admin's own, keeping theirs as the fallback", async () => {
    const rows: Record<string, string> = {
      "user:boss@example.test:STRIPE_KEY": "personal-token",
      "org:org-1:STRIPE_KEY": "shared-org-token",
    };
    readAppSecret.mockImplementation(async (ref: any) => {
      const value = rows[`${ref.scope}:${ref.scopeId}:${ref.key}`];
      return value ? { value, last4: "oken", updatedAt: 1 } : null;
    });
    const { resolveCredentialDetailed } = await import("./index.js");
    const ctx = { userEmail: "boss@example.test", orgId: "org-1" };

    for (const role of ["owner", "admin"]) {
      readOrgMemberRole.mockResolvedValue(role);
      await expect(
        resolveCredentialDetailed("STRIPE_KEY", ctx),
      ).resolves.toMatchObject({ value: "shared-org-token", scope: "org" });
    }
    readOrgMemberRole.mockResolvedValue("member");
    await expect(
      resolveCredentialDetailed("STRIPE_KEY", ctx),
    ).resolves.toMatchObject({ value: "personal-token", scope: "user" });

    delete rows["org:org-1:STRIPE_KEY"];
    readOrgMemberRole.mockResolvedValue("owner");
    await expect(
      resolveCredentialDetailed("STRIPE_KEY", ctx),
    ).resolves.toMatchObject({ value: "personal-token", scope: "user" });

    readOrgMemberRole.mockRejectedValue(new Error("db query timed out"));
    await expect(resolveCredentialDetailed("STRIPE_KEY", ctx)).rejects.toThrow(
      "db query timed out",
    );
  });

  it("returns undefined when the encryption key rotated (cannot decrypt)", async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "key-A";
    const { saveCredential, resolveCredential } = await import("./index.js");
    await saveCredential("ROTATED", "v", { userEmail: "a@x.com" });
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

describe("deleteResolvedCredential", () => {
  const appSecrets = new Map<string, string>();
  const rowKey = (ref: any) => `${ref.scope}:${ref.scopeId}:${ref.key}`;

  beforeEach(() => {
    appSecrets.clear();
    readAppSecret.mockImplementation(async (ref: any) => {
      const value = appSecrets.get(rowKey(ref));
      return value ? { value, last4: "alue", updatedAt: 1 } : null;
    });
    deleteAppSecret.mockImplementation(async (ref: any) =>
      appSecrets.delete(rowKey(ref)),
    );
  });

  const member = { userEmail: "member@example.test", orgId: "org-1" };

  it("removes the organization's legacy workspace row for an owner or admin", async () => {
    appSecrets.set("workspace:org-1:STRIPE_KEY", "shared-workspace-value");
    readOrgMemberRole.mockResolvedValue("admin");
    const { deleteResolvedCredential, resolveCredential } =
      await import("./index.js");

    await deleteResolvedCredential("STRIPE_KEY", member);

    await expect(
      resolveCredential("STRIPE_KEY", member),
    ).resolves.toBeUndefined();
  });

  it("refuses a member's removal of the organization's workspace row", async () => {
    appSecrets.set("workspace:org-1:STRIPE_KEY", "shared-workspace-value");
    const { deleteResolvedCredential, CredentialDeleteForbiddenError } =
      await import("./index.js");

    await expect(
      deleteResolvedCredential("STRIPE_KEY", member),
    ).rejects.toBeInstanceOf(CredentialDeleteForbiddenError);
    expect(appSecrets.has("workspace:org-1:STRIPE_KEY")).toBe(true);
  });

  it("refuses a member's removal of the organization's legacy setting", async () => {
    store.set("o:org-1:credential:STRIPE_KEY", { value: "org-setting-value" });
    const { deleteResolvedCredential, CredentialDeleteForbiddenError } =
      await import("./index.js");

    await expect(
      deleteResolvedCredential("STRIPE_KEY", member),
    ).rejects.toBeInstanceOf(CredentialDeleteForbiddenError);
    expect(store.has("o:org-1:credential:STRIPE_KEY")).toBe(true);
  });

  it("removes a member's own pre-organization solo row", async () => {
    appSecrets.set(
      "workspace:solo:member@example.test:STRIPE_KEY",
      "solo-value",
    );
    const { deleteResolvedCredential, resolveCredential } =
      await import("./index.js");

    await deleteResolvedCredential("STRIPE_KEY", member);

    await expect(
      resolveCredential("STRIPE_KEY", member),
    ).resolves.toBeUndefined();
    expect(readOrgMemberRole).not.toHaveBeenCalledWith(
      "solo:member@example.test",
      expect.anything(),
    );
  });

  it("removes every copy of the member's own key, leaving the organization's to answer", async () => {
    appSecrets.set("user:member@example.test:STRIPE_KEY", "personal-value");
    store.set("u:member@example.test:credential:STRIPE_KEY", {
      value: "personal-setting-value",
    });
    appSecrets.set("org:org-1:STRIPE_KEY", "org-value");
    const { deleteResolvedCredential, resolveCredential } =
      await import("./index.js");

    await deleteResolvedCredential("STRIPE_KEY", member);

    await expect(resolveCredential("STRIPE_KEY", member)).resolves.toBe(
      "org-value",
    );
  });

  it("clears only the chosen owner's rows when told which", async () => {
    appSecrets.set("user:member@example.test:STRIPE_KEY", "personal-value");
    appSecrets.set("workspace:solo:member@example.test:STRIPE_KEY", "solo");
    appSecrets.set("org:org-1:STRIPE_KEY", "org-value");
    appSecrets.set("workspace:org-1:STRIPE_KEY", "workspace-value");
    store.set("o:org-1:credential:STRIPE_KEY", { value: "org-setting-value" });
    const { deleteCredential } = await import("./index.js");

    await deleteCredential("STRIPE_KEY", { ...member, scope: "user" });
    expect([...appSecrets.keys()].sort()).toEqual([
      "org:org-1:STRIPE_KEY",
      "workspace:org-1:STRIPE_KEY",
    ]);

    await deleteCredential("STRIPE_KEY", { ...member, scope: "org" });
    expect(appSecrets.size).toBe(0);
    expect(store.has("o:org-1:credential:STRIPE_KEY")).toBe(false);
  });

  it("does not guess a role it cannot read", async () => {
    appSecrets.set("org:org-1:STRIPE_KEY", "org-value");
    readOrgMemberRole.mockRejectedValue(new Error("db query timed out"));
    const { deleteResolvedCredential } = await import("./index.js");

    await expect(
      deleteResolvedCredential("STRIPE_KEY", member),
    ).rejects.toThrow("db query timed out");
    expect(appSecrets.has("org:org-1:STRIPE_KEY")).toBe(true);
  });
});
