import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, Record<string, unknown>>();

vi.mock("../../settings/index.js", () => ({
  getOrgSetting: vi.fn(
    async (orgId: string, key: string) =>
      store.get(`org:${orgId}:${key}`) ?? null,
  ),
  putOrgSetting: vi.fn(
    async (orgId: string, key: string, value: Record<string, unknown>) => {
      store.set(`org:${orgId}:${key}`, value);
    },
  ),
  deleteOrgSetting: vi.fn(async (orgId: string, key: string) =>
    store.delete(`org:${orgId}:${key}`),
  ),
  getUserSetting: vi.fn(
    async (email: string, key: string) =>
      store.get(`user:${email}:${key}`) ?? null,
  ),
  putUserSetting: vi.fn(
    async (email: string, key: string, value: Record<string, unknown>) => {
      store.set(`user:${email}:${key}`, value);
    },
  ),
  deleteUserSetting: vi.fn(async (email: string, key: string) =>
    store.delete(`user:${email}:${key}`),
  ),
}));

vi.mock("../../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: vi.fn(async (_orgId: string, email: string) =>
    email.startsWith("admin") ? "admin" : "member",
  ),
}));

let keySource: "user" | "org" | undefined = "org";
vi.mock("../../server/credential-provider.js", () => ({
  resolveSecretDetailed: vi.fn(async () =>
    keySource
      ? { value: "fake-placeholder", lookupFailed: false, source: keySource }
      : { value: null, lookupFailed: false },
  ),
  resolveBuilderCredentialsDetailed: vi.fn(async () => ({
    source: "org",
    lookupFailed: false,
  })),
}));

import getAction from "./get-provider-models.js";
import manageAction from "./manage-provider-models.js";

const admin = {
  userEmail: "admin@example.test",
  orgId: "org-1",
  caller: "agent",
} as any;
const member = {
  userEmail: "member@example.test",
  orgId: "org-1",
  caller: "agent",
} as any;

describe("manage-provider-models", () => {
  beforeEach(() => {
    store.clear();
    keySource = "org";
  });

  it("sets the organization's models for an admin", async () => {
    await expect(
      manageAction.run(
        {
          action: "set",
          provider: "openai",
          scope: "org",
          models: ["gpt-6-sol"],
        },
        admin,
      ),
    ).resolves.toMatchObject({ scope: "org", models: ["gpt-6-sol"] });
  });

  it("refuses a member's organization change with 403", async () => {
    await expect(
      manageAction.run(
        { action: "set", provider: "openai", scope: "org", models: [] },
        member,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("defaults to the scope of the key in effect", async () => {
    keySource = "user";
    await expect(
      manageAction.run(
        { action: "set", provider: "openai", models: ["gpt-5.6-luna"] },
        member,
      ),
    ).resolves.toMatchObject({ scope: "user", models: ["gpt-5.6-luna"] });
  });

  it("requires models for set", async () => {
    await expect(
      manageAction.run({ action: "set", provider: "openai" }, member),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires a signed-in caller", async () => {
    await expect(
      manageAction.run({ action: "reset", provider: "openai" }, {
        caller: "agent",
      } as any),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("get-provider-models", () => {
  beforeEach(() => {
    store.clear();
    keySource = "org";
  });

  it("shows members the organization's models read-only", async () => {
    await manageAction.run(
      {
        action: "set",
        provider: "openai",
        scope: "org",
        models: ["gpt-6-sol"],
      },
      admin,
    );
    const result = (await getAction.run({ provider: "openai" }, member)) as any;
    expect(result.canManageOrg).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({
      provider: "openai",
      label: "OpenAI",
      state: "selected",
      scope: "org",
      models: ["gpt-6-sol"],
      rows: {
        user: { models: null },
        org: { models: ["gpt-6-sol"] },
      },
    });
    expect(result.providers[0].recommendedModels.length).toBeGreaterThan(0);
  });

  it("lists every provider, Builder.io first", async () => {
    const result = (await getAction.run({}, admin)) as any;
    expect(result.canManageOrg).toBe(true);
    expect(result.providers[0]).toMatchObject({
      provider: "builder",
      label: "Builder.io",
      state: "default",
    });
    expect(result.providers.map((entry: any) => entry.provider)).toContain(
      "ollama",
    );
  });
});
