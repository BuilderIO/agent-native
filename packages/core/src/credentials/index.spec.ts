import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for the settings table so we can inspect what is
// persisted at rest (the whole point of this fix).
const store = new Map<string, { value: unknown }>();

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
