import { beforeEach, describe, expect, it, vi } from "vitest";

const orgStore = new Map<string, Record<string, unknown>>();
const userStore = new Map<string, Record<string, unknown>>();
let settingsReadThrows = false;

vi.mock("../settings/index.js", () => ({
  getOrgSetting: vi.fn(async (orgId: string, key: string) => {
    if (settingsReadThrows) throw new Error("settings store down");
    return orgStore.get(`${orgId}::${key}`) ?? null;
  }),
  putOrgSetting: vi.fn(
    async (orgId: string, key: string, value: Record<string, unknown>) => {
      orgStore.set(`${orgId}::${key}`, value);
    },
  ),
  deleteOrgSetting: vi.fn(async (orgId: string, key: string) =>
    orgStore.delete(`${orgId}::${key}`),
  ),
  getUserSetting: vi.fn(async (email: string, key: string) => {
    if (settingsReadThrows) throw new Error("settings store down");
    return userStore.get(`${email}::${key}`) ?? null;
  }),
  putUserSetting: vi.fn(
    async (email: string, key: string, value: Record<string, unknown>) => {
      userStore.set(`${email}::${key}`, value);
    },
  ),
  deleteUserSetting: vi.fn(async (email: string, key: string) =>
    userStore.delete(`${email}::${key}`),
  ),
}));

const roles = new Map<string, "owner" | "admin" | "member">();
vi.mock("../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: vi.fn(
    async (orgId: string, email: string) =>
      roles.get(`${orgId}::${email}`) ?? null,
  ),
}));

type KeySource = "user" | "org" | "env" | undefined;
const keySources = new Map<string, KeySource>();
let keyLookupFails = false;
let builderSource: KeySource = undefined;
vi.mock("../server/credential-provider.js", () => ({
  resolveSecretDetailed: vi.fn(async (key: string) => {
    if (keyLookupFails) return { value: null, lookupFailed: true };
    const source = keySources.get(key);
    return source
      ? { value: "fake-placeholder", lookupFailed: false, source }
      : { value: null, lookupFailed: false };
  }),
  resolveBuilderCredentialsDetailed: vi.fn(async () => ({
    source: builderSource ?? null,
    lookupFailed: false,
  })),
}));

let requestUserEmail: string | undefined;
let requestOrgId: string | undefined;
vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: () => requestUserEmail,
  getRequestOrgId: () => requestOrgId,
}));

const {
  ProviderModelSelectionError,
  applyProviderModelSelection,
  normalizeSelectedModels,
  providerForEngineName,
  readProviderModelSelection,
  resetProviderModelSelection,
  resolveEffectiveProviderModelSelection,
  resolveProviderModelSelectionAtScope,
  resolveUncheckedDefaultModelReplacement,
  writeProviderModelSelection,
} = await import("./provider-model-selection.js");

const ORG = "org-1";
const OWNER = "owner@example.com";
const MEMBER = "member@example.com";

beforeEach(() => {
  orgStore.clear();
  userStore.clear();
  roles.clear();
  keySources.clear();
  settingsReadThrows = false;
  keyLookupFails = false;
  builderSource = undefined;
  requestUserEmail = undefined;
  requestOrgId = undefined;
  roles.set(`${ORG}::${OWNER}`, "owner");
  roles.set(`${ORG}::${MEMBER}`, "member");
});

describe("providerForEngineName", () => {
  it("maps engines to the provider whose key they use", () => {
    expect(providerForEngineName("builder")).toBe("builder");
    expect(providerForEngineName("anthropic")).toBe("anthropic");
    expect(providerForEngineName("ai-sdk:anthropic")).toBe("anthropic");
    expect(providerForEngineName("ai-sdk:ollama")).toBe("ollama");
    expect(providerForEngineName("chatgpt-subscription")).toBeNull();
    expect(providerForEngineName("ai-sdk:unknown")).toBeNull();
  });
});

describe("normalizeSelectedModels", () => {
  it("trims and de-duplicates in order", () => {
    expect(
      normalizeSelectedModels("openai", [" gpt-6-sol", "gpt-5.6-luna", ""]),
    ).toEqual(["gpt-6-sol", "gpt-5.6-luna"]);
    expect(
      normalizeSelectedModels("openai", ["gpt-6-sol", "gpt-6-sol"]),
    ).toEqual(["gpt-6-sol"]);
  });

  it("accepts ids outside the catalog for key providers", () => {
    expect(
      normalizeSelectedModels("ollama", ["qwen3.8-code-131k:latest"]),
    ).toEqual(["qwen3.8-code-131k:latest"]);
  });

  it("refuses Builder.io ids outside its catalog", () => {
    expect(() => normalizeSelectedModels("builder", ["gpt-9000"])).toThrow(
      ProviderModelSelectionError,
    );
  });

  it("refuses ids with whitespace", () => {
    expect(() => normalizeSelectedModels("openai", ["gpt 6"])).toThrow(
      ProviderModelSelectionError,
    );
  });
});

describe("selection scopes", () => {
  it("lets an owner set the organization's models", async () => {
    await writeProviderModelSelection(
      { userEmail: OWNER, orgId: ORG },
      "openai",
      "org",
      ["gpt-6-sol"],
    );
    const row = await readProviderModelSelection(
      { userEmail: MEMBER, orgId: ORG },
      "openai",
      "org",
    );
    expect(row.models).toEqual(["gpt-6-sol"]);
    expect(row.updatedBy).toBe(OWNER);
  });

  it("refuses a member's organization write", async () => {
    await expect(
      writeProviderModelSelection(
        { userEmail: MEMBER, orgId: ORG },
        "openai",
        "org",
        ["gpt-6-sol"],
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(orgStore.size).toBe(0);
  });

  it("keeps a member's personal selection out of the organization's", async () => {
    await writeProviderModelSelection(
      { userEmail: OWNER, orgId: ORG },
      "openai",
      "org",
      ["gpt-6-sol", "gpt-5.6-luna"],
    );
    await writeProviderModelSelection(
      { userEmail: MEMBER, orgId: ORG },
      "openai",
      "user",
      ["gpt-5.6-luna"],
    );

    const org = await readProviderModelSelection(
      { userEmail: OWNER, orgId: ORG },
      "openai",
      "org",
    );
    const ownerPersonal = await readProviderModelSelection(
      { userEmail: OWNER, orgId: ORG },
      "openai",
      "user",
    );
    expect(org.models).toEqual(["gpt-6-sol", "gpt-5.6-luna"]);
    expect(ownerPersonal.models).toBeNull();
  });

  it("refuses organization scope without an organization", async () => {
    await expect(
      readProviderModelSelection({ userEmail: OWNER }, "openai", "org"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("resets back to the recommended models", async () => {
    await writeProviderModelSelection(
      { userEmail: MEMBER, orgId: ORG },
      "openai",
      "user",
      [],
    );
    const cleared = await resetProviderModelSelection(
      { userEmail: MEMBER, orgId: ORG },
      "openai",
      "user",
    );
    expect(cleared.models).toBeNull();
  });
});

describe("resolveEffectiveProviderModelSelection", () => {
  beforeEach(async () => {
    await writeProviderModelSelection(
      { userEmail: OWNER, orgId: ORG },
      "openai",
      "org",
      ["gpt-6-sol"],
    );
    await writeProviderModelSelection(
      { userEmail: MEMBER, orgId: ORG },
      "openai",
      "user",
      ["gpt-5.6-luna"],
    );
  });

  it("uses the organization's selection while the organization key is in effect", async () => {
    keySources.set("OPENAI_API_KEY", "org");
    expect(
      await resolveEffectiveProviderModelSelection("openai", {
        userEmail: MEMBER,
        orgId: ORG,
      }),
    ).toEqual({
      state: "selected",
      provider: "openai",
      scope: "org",
      models: ["gpt-6-sol"],
    });
  });

  it("uses the member's own selection while their personal key is in effect", async () => {
    keySources.set("OPENAI_API_KEY", "user");
    expect(
      await resolveEffectiveProviderModelSelection("openai", {
        userEmail: MEMBER,
        orgId: ORG,
      }),
    ).toMatchObject({
      state: "selected",
      scope: "user",
      models: ["gpt-5.6-luna"],
    });
  });

  it("follows a personal Builder.io connection", async () => {
    builderSource = "user";
    expect(
      await resolveEffectiveProviderModelSelection("builder", {
        userEmail: MEMBER,
        orgId: ORG,
      }),
    ).toEqual({ state: "default", provider: "builder", scope: "user" });
  });

  it("reports an unreadable store instead of an empty choice", async () => {
    keySources.set("OPENAI_API_KEY", "org");
    settingsReadThrows = true;
    const selection = await resolveEffectiveProviderModelSelection("openai", {
      userEmail: MEMBER,
      orgId: ORG,
    });
    expect(selection).toMatchObject({ state: "unreadable" });
    expect(applyProviderModelSelection(["gpt-5.6-luna"], selection)).toEqual([
      "gpt-5.6-luna",
    ]);
  });

  it("reports an unreadable credential store", async () => {
    keyLookupFails = true;
    expect(
      await resolveEffectiveProviderModelSelection("openai", {
        userEmail: MEMBER,
        orgId: ORG,
      }),
    ).toMatchObject({ state: "unreadable" });
  });

  it("reads one fixed scope for the default-model select", async () => {
    keySources.set("OPENAI_API_KEY", "user");
    expect(
      await resolveProviderModelSelectionAtScope("openai", "org", {
        userEmail: MEMBER,
        orgId: ORG,
      }),
    ).toMatchObject({ state: "selected", scope: "org", models: ["gpt-6-sol"] });
  });
});

describe("resolveUncheckedDefaultModelReplacement", () => {
  beforeEach(() => {
    requestUserEmail = OWNER;
    requestOrgId = ORG;
    keySources.set("OPENAI_API_KEY", "org");
  });

  it("keeps the engine default while it is checked or nothing is checked", async () => {
    const engine = { name: "ai-sdk:openai", defaultModel: "gpt-5.6-luna" };
    expect(
      await resolveUncheckedDefaultModelReplacement(engine),
    ).toBeUndefined();
    await writeProviderModelSelection(
      { userEmail: OWNER, orgId: ORG },
      "openai",
      "org",
      ["gpt-6-sol", "gpt-5.6-luna"],
    );
    expect(
      await resolveUncheckedDefaultModelReplacement(engine),
    ).toBeUndefined();
  });

  it("moves to the first checked model once the default is unchecked", async () => {
    await writeProviderModelSelection(
      { userEmail: OWNER, orgId: ORG },
      "openai",
      "org",
      ["gpt-6-sol"],
    );
    expect(
      await resolveUncheckedDefaultModelReplacement({
        name: "ai-sdk:openai",
        defaultModel: "gpt-5.6-luna",
      }),
    ).toBe("gpt-6-sol");
  });

  it("keeps the engine default when the selection can't be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    settingsReadThrows = true;
    expect(
      await resolveUncheckedDefaultModelReplacement({
        name: "ai-sdk:openai",
        defaultModel: "gpt-5.6-luna",
      }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
