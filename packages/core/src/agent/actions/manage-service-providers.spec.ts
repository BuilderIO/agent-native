import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  roles: new Map<string, "owner" | "admin" | "member">(),
  // key name -> { shared, personal } values; "fail" marks an unreadable store.
  keys: new Map<string, { shared?: string; personal?: string; fail?: true }>(),
  builder: { source: null as string | null, lookupFailed: false },
  recordActionAudit: vi.fn(async (_input: unknown) => {}),
}));

vi.mock("../../settings/store.js", () => ({
  getSetting: async (key: string) => mocks.settings.get(key) ?? null,
  mutateSetting: async (
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ) => {
    const next = await update(mocks.settings.get(key) ?? null);
    mocks.settings.set(key, next);
    return next;
  },
}));

vi.mock("../../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async (orgId: string, email: string) =>
    mocks.roles.get(`${orgId}:${email}`) ?? null,
}));

vi.mock("../../server/credential-provider.js", () => ({
  prefetchSecrets: async () => undefined,
  resolveBuilderCredentialsDetailed: async () =>
    mocks.builder.source
      ? {
          privateKey: "bpk-test",
          publicKey: "pub-test",
          source: mocks.builder.source,
          lookupFailed: false,
        }
      : {
          privateKey: null,
          publicKey: null,
          source: null,
          lookupFailed: mocks.builder.lookupFailed,
        },
}));

vi.mock("../../server/secret-key-aliases.js", () => ({
  secretKeyNames: (key: string) => [key],
  resolveSecretWithAliasesDetailed: async (
    key: string,
    options: { skipUserScope?: boolean } = {},
  ) => {
    const entry = mocks.keys.get(key);
    if (entry?.fail) return { value: null, lookupFailed: true };
    if (entry?.personal && !options.skipUserScope) {
      return { value: entry.personal, lookupFailed: false, source: "user" };
    }
    if (entry?.shared) {
      return { value: entry.shared, lookupFailed: false, source: "org" };
    }
    return { value: null, lookupFailed: false };
  },
}));

vi.mock("../../audit/record.js", () => ({
  recordActionAudit: mocks.recordActionAudit,
}));

const { default: action } = await import("./manage-service-providers.js");

const ctx = (email: string, orgId: string | null = "org-1") => ({
  actionName: "manage-service-providers",
  caller: "frontend" as const,
  userEmail: email,
  orgId,
});

const ADMIN = "admin@example.com";
const MEMBER = "member@example.com";

function service(result: Awaited<ReturnType<typeof action.run>>, id: string) {
  const found = result.services.find((entry) => entry.service === id);
  expect(found).toBeDefined();
  return found!;
}

beforeEach(() => {
  mocks.settings.clear();
  mocks.roles.clear();
  mocks.keys.clear();
  mocks.builder.source = null;
  mocks.builder.lookupFailed = false;
  mocks.recordActionAudit.mockClear();
  mocks.roles.set(`org-1:${ADMIN}`, "admin");
  mocks.roles.set(`org-1:${MEMBER}`, "member");
});

describe("manage-service-providers", () => {
  it("reads every service with its options and key states", async () => {
    mocks.builder.source = "org";
    mocks.keys.set("GOOGLE_GENERATIVE_AI_API_KEY", { shared: "g-test" });
    mocks.keys.set("GROQ_API_KEY", { personal: "gsk-test" });
    mocks.keys.set("COHERE_API_KEY", { fail: true });

    const result = await action.run({}, ctx(ADMIN));

    expect(result.canManage).toBe(true);
    expect(result.services.map((entry) => entry.service)).toEqual([
      "voice",
      "images",
      "embeddings",
    ]);
    expect(service(result, "voice")).toEqual({
      service: "voice",
      provider: null,
      effectiveProvider: "builder",
      options: [
        { provider: "builder", keyState: "org" },
        {
          provider: "gemini",
          keyName: "GOOGLE_GENERATIVE_AI_API_KEY",
          keyState: "org",
        },
        { provider: "groq", keyName: "GROQ_API_KEY", keyState: "personal" },
        { provider: "openai", keyName: "OPENAI_API_KEY", keyState: "none" },
      ],
    });
    expect(service(result, "embeddings").options).toContainEqual({
      provider: "cohere",
      keyName: "COHERE_API_KEY",
      keyState: "unavailable",
    });
    expect(mocks.recordActionAudit).not.toHaveBeenCalled();
  });

  it("lets owners and admins choose a provider, and puts it first", async () => {
    mocks.keys.set("GROQ_API_KEY", { shared: "gsk-test" });
    mocks.builder.source = "org";

    const result = await action.run(
      { service: "voice", provider: "groq" },
      ctx(ADMIN),
    );

    expect(result.changed).toBe(true);
    expect(service(result, "voice")).toMatchObject({
      provider: "groq",
      effectiveProvider: "groq",
    });
    expect(mocks.settings.get("o:org-1:service-providers")).toMatchObject({
      voice: "groq",
      updatedBy: ADMIN,
    });
    expect(mocks.recordActionAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordActionAudit.mock.calls[0]![0]).toMatchObject({
      status: "success",
      ctx: { actionName: "manage-service-providers", orgId: "org-1" },
    });

    // "builder" returns the service to Builder.io.
    const back = await action.run(
      { service: "voice", provider: "builder" },
      ctx(ADMIN),
    );
    expect(service(back, "voice")).toMatchObject({
      provider: "builder",
      effectiveProvider: "builder",
    });
  });

  it("refuses members' changes and records the refusal", async () => {
    await expect(
      action.run({ service: "voice", provider: "groq" }, ctx(MEMBER)),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "service_providers_admin_required",
    });
    expect(mocks.settings.size).toBe(0);
    expect(mocks.recordActionAudit.mock.calls[0]![0]).toMatchObject({
      status: "denied",
    });

    // Members can still read the choices.
    const read = await action.run({}, ctx(MEMBER));
    expect(read.canManage).toBe(false);
  });

  it("refuses a provider the service can't use", async () => {
    await expect(
      action.run({ service: "images", provider: "groq" }, ctx(ADMIN)),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      action.run({ provider: "groq" }, ctx(ADMIN)),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.settings.size).toBe(0);
  });

  it("refuses callers outside the organization", async () => {
    await expect(
      action.run({}, ctx("stranger@example.com")),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(action.run({}, ctx(ADMIN, null))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("flags a re-index when the embeddings provider that answers changes", async () => {
    mocks.builder.source = "org";
    mocks.keys.set("GOOGLE_GENERATIVE_AI_API_KEY", { shared: "g-test" });

    const toGemini = await action.run(
      { service: "embeddings", provider: "gemini" },
      ctx(ADMIN),
    );
    expect(toGemini.reindexRequired).toBe(true);
    expect(service(toGemini, "embeddings").effectiveProvider).toBe("gemini");

    // Unset already answered with Builder.io, so choosing it changes nothing.
    await action.run({ service: "embeddings", provider: null }, ctx(ADMIN));
    const toBuilder = await action.run(
      { service: "embeddings", provider: "builder" },
      ctx(ADMIN),
    );
    expect(toBuilder.changed).toBe(true);
    expect(toBuilder.reindexRequired).toBeUndefined();

    // A chosen embeddings provider without a key doesn't fall back.
    const toVoyage = await action.run(
      { service: "embeddings", provider: "voyage" },
      ctx(ADMIN),
    );
    expect(service(toVoyage, "embeddings").effectiveProvider).toBeNull();
    expect(toVoyage.reindexRequired).toBe(true);
  });

  it("falls back past a voice choice with no key", async () => {
    mocks.keys.set("OPENAI_API_KEY", { shared: "sk-test" });
    const result = await action.run(
      { service: "voice", provider: "groq" },
      ctx(ADMIN),
    );
    expect(service(result, "voice").effectiveProvider).toBe("openai");
  });
});
