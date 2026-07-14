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

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "credentials-spec-key";
  store.clear();
  readAppSecret.mockReset();
  readAppSecret.mockResolvedValue(null);
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
