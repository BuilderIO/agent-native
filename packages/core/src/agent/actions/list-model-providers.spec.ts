import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // `${scope}:${scopeId}` -> key -> value
  secrets: new Map<string, Map<string, string>>(),
  rejected: new Map<string, number>(),
  rejectionsFail: false,
  roles: new Map<string, string>(),
  restricted: false,
  defaultValue: null as Record<string, unknown> | null,
  defaultSource: "none" as "org" | "user" | "legacy" | "none",
  authorityAllowed: true,
}));

vi.mock("../../secrets/storage.js", () => ({
  readAppSecrets: async (args: {
    keys: readonly string[];
    scope: string;
    scopeId: string;
  }) => {
    const stored = mocks.secrets.get(`${args.scope}:${args.scopeId}`);
    const rows = new Map<
      string,
      { value: string; last4: string; updatedAt: number }
    >();
    for (const key of args.keys) {
      const value = stored?.get(key);
      if (value) {
        rows.set(key, {
          value,
          last4: `••••${value.slice(-4)}`,
          updatedAt: 1_700_000_000_000,
        });
      }
    }
    return rows;
  },
}));

vi.mock("../../server/credential-provider.js", () => ({
  readProviderCredentialRejections: async (
    credentials: Array<{ key: string; value: string }>,
  ) => {
    if (mocks.rejectionsFail) throw new Error("settings unreadable");
    const result = new Map<string, { at: number }>();
    for (const { key, value } of credentials) {
      const at = mocks.rejected.get(`${key}=${value}`);
      if (at) result.set(key, { at });
    }
    return result;
  },
}));

vi.mock("../../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async (orgId: string, email: string) =>
    mocks.roles.get(`${orgId}:${email}`) ?? null,
  isPersonalProviderKeyUseRestricted: async (input: { role?: string }) =>
    mocks.restricted && input.role !== "owner" && input.role !== "admin",
}));

vi.mock("../default-agent-engine.js", () => ({
  readDefaultAgentEngineSettingDetailed: async () => ({
    value: mocks.defaultValue,
    source: mocks.defaultSource,
  }),
  resolveDefaultAgentEngineAuthority: async () =>
    mocks.authorityAllowed
      ? { allowed: true, scope: "org", orgId: "org-1", userEmail: "x" }
      : { allowed: false, reason: "not-admin", message: "no" },
}));

const { default: action } = await import("./list-model-providers.js");

function setSecret(scope: string, scopeId: string, key: string, value: string) {
  const bucket = mocks.secrets.get(`${scope}:${scopeId}`) ?? new Map();
  bucket.set(key, value);
  mocks.secrets.set(`${scope}:${scopeId}`, bucket);
}

function run(userEmail: string | undefined, orgId: string | null = "org-1") {
  return action.run({}, {
    actionName: "list-model-providers",
    caller: "frontend",
    userEmail,
    orgId,
  } as never);
}

function entry(
  listing: Awaited<ReturnType<typeof run>>,
  provider: string,
): (typeof listing.providers)[number] {
  const found = listing.providers.find((item) => item.provider === provider);
  if (!found) throw new Error(`No ${provider}`);
  return found;
}

beforeEach(() => {
  mocks.secrets.clear();
  mocks.rejected.clear();
  mocks.rejectionsFail = false;
  mocks.roles.clear();
  mocks.roles.set("org-1:admin@example.com", "admin");
  mocks.roles.set("org-1:member@example.com", "member");
  mocks.restricted = false;
  mocks.defaultValue = null;
  mocks.defaultSource = "none";
  mocks.authorityAllowed = true;
});

describe("list-model-providers", () => {
  it("refuses a signed-out caller", async () => {
    await expect(run(undefined)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("lists every catalog provider in the framework's order", async () => {
    const listing = await run("admin@example.com");
    expect(listing.providers.map((item) => item.provider)).toEqual([
      "openrouter",
      "ollama",
      "anthropic",
      "openai",
      "google",
      "groq",
      "mistral",
      "cohere",
    ]);
    expect(listing.providers.every((item) => !item.org && !item.personal)).toBe(
      true,
    );
  });

  it("shows admins the organization key's mask and gateway", async () => {
    setSecret("org", "org-1", "OPENAI_API_KEY", "sk-test-fake-1111");
    setSecret("org", "org-1", "OPENAI_BASE_URL", "https://gateway.example/v1");
    const listing = await run("admin@example.com");
    expect(listing.canManageOrg).toBe(true);
    expect(entry(listing, "openai").org).toEqual({
      scope: "org",
      masked: "••••1111",
      endpoint: "https://gateway.example/v1",
      updatedAt: 1_700_000_000_000,
    });
  });

  it("tells members an organization key exists without its mask", async () => {
    setSecret("org", "org-1", "ANTHROPIC_API_KEY", "sk-ant-test-fake-2222");
    setSecret(
      "org",
      "org-1",
      "OLLAMA_BASE_URL",
      "http://ollama.internal:11434",
    );
    const listing = await run("member@example.com");
    expect(listing.canManageOrg).toBe(false);
    expect(entry(listing, "anthropic").org).toEqual({
      scope: "org",
      updatedAt: 1_700_000_000_000,
    });
    expect(entry(listing, "ollama").org).toEqual({
      scope: "org",
      updatedAt: 1_700_000_000_000,
    });
  });

  it("lists a member's personal key next to the organization's", async () => {
    setSecret("org", "org-1", "ANTHROPIC_API_KEY", "sk-ant-test-fake-2222");
    setSecret(
      "user",
      "member@example.com",
      "ANTHROPIC_API_KEY",
      "sk-ant-test-fake-3333",
    );
    const listing = await run("member@example.com");
    expect(entry(listing, "anthropic").personal).toMatchObject({
      scope: "user",
      masked: "••••3333",
    });
    expect(entry(listing, "anthropic").org).not.toBeNull();
  });

  it("lists a key in the organization's legacy workspace row as the organization's", async () => {
    setSecret(
      "workspace",
      "org-1",
      "ANTHROPIC_API_KEY",
      "sk-ant-test-fake-8888",
    );
    const admin = await run("admin@example.com");
    expect(entry(admin, "anthropic").org).toEqual({
      scope: "org",
      masked: "••••8888",
      updatedAt: 1_700_000_000_000,
      legacyWorkspaceRow: true,
    });
    const member = await run("member@example.com");
    expect(entry(member, "anthropic").org).toEqual({
      scope: "org",
      updatedAt: 1_700_000_000_000,
      legacyWorkspaceRow: true,
    });
  });

  it("prefers the organization row over its legacy workspace row", async () => {
    setSecret("org", "org-1", "ANTHROPIC_API_KEY", "sk-ant-test-fake-1212");
    setSecret(
      "workspace",
      "org-1",
      "ANTHROPIC_API_KEY",
      "sk-ant-test-fake-8888",
    );
    const listing = await run("admin@example.com");
    expect(entry(listing, "anthropic").org).toEqual({
      scope: "org",
      masked: "••••1212",
      updatedAt: 1_700_000_000_000,
    });
  });

  it("lists a key in the caller's solo workspace row as personal", async () => {
    setSecret(
      "workspace",
      "solo:member@example.com",
      "OPENAI_API_KEY",
      "sk-test-fake-9999",
    );
    setSecret(
      "workspace",
      "solo:member@example.com",
      "OPENAI_BASE_URL",
      "https://gateway.example/v1",
    );
    for (const orgId of ["org-1", null]) {
      const listing = await run("member@example.com", orgId);
      expect(entry(listing, "openai").personal).toEqual({
        scope: "user",
        masked: "••••9999",
        endpoint: "https://gateway.example/v1",
        updatedAt: 1_700_000_000_000,
        legacyWorkspaceRow: true,
      });
    }
  });

  it("reads a Gemini key saved under its older name", async () => {
    setSecret("user", "member@example.com", "GEMINI_API_KEY", "AIza-test-4444");
    mocks.rejected.set(
      "GOOGLE_GENERATIVE_AI_API_KEY=AIza-test-4444",
      1_700_000_500_000,
    );
    const listing = await run("member@example.com");
    expect(entry(listing, "google").personal).toMatchObject({
      masked: "••••4444",
      rejectedAt: 1_700_000_500_000,
    });
  });

  it("reports a key its provider rejected", async () => {
    setSecret("org", "org-1", "GROQ_API_KEY", "gsk_test_5555");
    mocks.rejected.set("GROQ_API_KEY=gsk_test_5555", 1_700_000_900_000);
    const listing = await run("member@example.com");
    expect(entry(listing, "groq").org?.rejectedAt).toBe(1_700_000_900_000);
  });

  it("says when rejections couldn't be read instead of reporting the key fine", async () => {
    setSecret(
      "user",
      "admin@example.com",
      "MISTRAL_API_KEY",
      "mistral-test-6666",
    );
    mocks.rejectionsFail = true;
    const listing = await run("admin@example.com");
    expect(entry(listing, "mistral").personal).toMatchObject({
      rejectionUnknown: true,
    });
    expect(entry(listing, "mistral").personal?.rejectedAt).toBeUndefined();
  });

  it("reports the restriction for members and not for admins", async () => {
    mocks.restricted = true;
    await expect(run("member@example.com")).resolves.toMatchObject({
      personalKeysRestricted: true,
    });
    await expect(run("admin@example.com")).resolves.toMatchObject({
      personalKeysRestricted: false,
    });
  });

  it("returns the stored default model and who may change it", async () => {
    mocks.defaultValue = { engine: "ai-sdk:groq", model: "llama-3.3-70b" };
    mocks.defaultSource = "org";
    mocks.authorityAllowed = false;
    await expect(run("member@example.com")).resolves.toMatchObject({
      defaultModel: { engine: "ai-sdk:groq", model: "llama-3.3-70b" },
      defaultModelSource: "org",
      canUpdateDefault: false,
    });
  });

  it("reads only personal keys without an organization", async () => {
    setSecret(
      "user",
      "solo@example.com",
      "OPENROUTER_API_KEY",
      "sk-or-test-fake-7777",
    );
    const listing = await run("solo@example.com", null);
    expect(listing).toMatchObject({
      hasOrganization: false,
      canManageOrg: false,
      personalKeysRestricted: false,
    });
    expect(entry(listing, "openrouter").personal?.masked).toBe("••••7777");
    expect(listing.providers.every((item) => item.org === null)).toBe(true);
  });
});
