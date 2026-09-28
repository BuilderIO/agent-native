import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VAULT_PREFIX = "Synced from Dispatch vault:";

interface Row {
  key: string;
  value: string;
  description?: string;
}

const mocks = vi.hoisted(() => ({
  // `${scope}:${scopeId}` -> rows
  rows: new Map<string, Row[]>(),
  roles: new Map<string, string>(),
  deleted: [] as string[],
}));

vi.mock("./storage.js", () => ({
  VAULT_SYNC_DESCRIPTION_PREFIX: "Synced from Dispatch vault:",
  listAppSecretsForScope: async (scope: string, scopeId: string) =>
    (mocks.rows.get(`${scope}:${scopeId}`) ?? []).map((row) => ({
      key: row.key,
      scope,
      scopeId,
      last4: `••••${row.value.slice(-4)}`,
      description: row.description ?? null,
      urlAllowlist: null,
      createdAt: 1,
      updatedAt: 1_700_000_000_000,
    })),
  deleteAppSecret: async (ref: {
    key: string;
    scope: string;
    scopeId: string;
  }) => {
    const id = `${ref.scope}:${ref.scopeId}`;
    const rows = mocks.rows.get(id) ?? [];
    const next = rows.filter((row) => row.key !== ref.key);
    mocks.rows.set(id, next);
    if (next.length === rows.length) return false;
    mocks.deleted.push(`${id}:${ref.key}`);
    return true;
  },
}));

vi.mock("../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async (orgId: string, email: string) =>
    mocks.roles.get(`${orgId}:${email}`) ?? null,
}));

const { deleteApiKey, listApiKeys } = await import("./api-keys.js");
const { __resetSecretsRegistry, registerRequiredSecret } =
  await import("./register.js");
const { default: listAction } = await import("./actions/list-api-keys.js");
const { default: deleteAction } = await import("./actions/delete-api-key.js");

const ME = "me@example.com";
const ORG = "org-1";

function put(scope: string, scopeId: string, row: Row) {
  const id = `${scope}:${scopeId}`;
  mocks.rows.set(id, [...(mocks.rows.get(id) ?? []), row]);
}

function names(entries: Array<{ name: string; storedScope: string }>) {
  return entries.map((entry) => `${entry.storedScope}:${entry.name}`);
}

beforeEach(() => {
  mocks.rows.clear();
  mocks.roles.clear();
  mocks.deleted.length = 0;
  __resetSecretsRegistry();
});

afterEach(() => {
  __resetSecretsRegistry();
});

describe("listApiKeys", () => {
  it("shows a member only their own keys, and managed org keys without masks", async () => {
    mocks.roles.set(`${ORG}:${ME}`, "member");
    put("user", ME, { key: "ANTHROPIC_API_KEY", value: "fake-anthropic-1234" });
    put("user", ME, { key: "STRIPE_SECRET_KEY", value: "fake-stripe-5678" });
    put("org", ORG, { key: "OPENAI_API_KEY", value: "fake-openai-9999" });
    put("org", ORG, { key: "BUILDER_PRIVATE_KEY", value: "fake-builder-0000" });

    const listing = await listApiKeys({ email: ME, orgId: ORG });

    expect(names(listing.keys)).toEqual([
      "user:ANTHROPIC_API_KEY",
      "user:STRIPE_SECRET_KEY",
    ]);
    expect(listing.keys[0]).toMatchObject({
      scope: "user",
      masked: "••••1234",
      provider: "anthropic",
      canDelete: true,
      // Provider keys are managed in the provider dialog.
      canReplace: false,
    });
    expect(listing.keys[0]!.usedFor[0]).toMatchObject({ feature: "Agent" });
    expect(listing.keys[1]).toMatchObject({
      registered: false,
      canReplace: true,
      canDelete: true,
      canTest: false,
    });
    expect(listing.managed).toHaveLength(1);
    expect(listing.managed[0]).toMatchObject({
      name: "BUILDER_PRIVATE_KEY",
      scope: "org",
      managedBy: { id: "builder", route: "integrations/builder" },
      canDelete: false,
    });
    expect(listing.managed[0]!.masked).toBeUndefined();
    expect(listing.canManageOrg).toBe(false);
  });

  it("lists the organization's keys for admins, with vault rows read-only", async () => {
    mocks.roles.set(`${ORG}:${ME}`, "admin");
    put("org", ORG, { key: "OPENAI_API_KEY", value: "fake-openai-9999" });
    put("org", ORG, {
      key: "FIGMA_ACCESS_TOKEN",
      value: "fake-figma-1111",
      description: `${VAULT_PREFIX} FIGMA_ACCESS_TOKEN`,
    });
    put("workspace", ORG, { key: "SHARED_WEBHOOK", value: "fake-hook-2222" });

    const listing = await listApiKeys({ email: ME, orgId: ORG });

    expect(names(listing.keys)).toEqual([
      "org:OPENAI_API_KEY",
      "org:FIGMA_ACCESS_TOKEN",
      "workspace:SHARED_WEBHOOK",
    ]);
    expect(listing.keys[1]).toMatchObject({
      vault: true,
      canDelete: false,
      canReplace: false,
    });
    expect(listing.keys[2]).toMatchObject({
      scope: "org",
      canReplace: true,
      canDelete: true,
    });
    expect(listing.canManageOrg).toBe(true);
  });

  it("lists legacy solo rows with the caller's own keys", async () => {
    mocks.roles.set(`${ORG}:${ME}`, "member");
    put("workspace", `solo:${ME}`, {
      key: "GEMINI_API_KEY",
      value: "fake-gemini-3333",
    });
    put("workspace", `solo:${ME}`, {
      key: "OLD_TOKEN",
      value: "fake-old-4444",
    });

    const listing = await listApiKeys({ email: ME, orgId: ORG });

    expect(listing.keys.map((entry) => entry.scope)).toEqual(["user", "user"]);
    expect(listing.keys[0]).toMatchObject({
      storedScope: "workspace",
      provider: "google",
      canDelete: true,
    });
    // Replacing would write the org's workspace row, not this one.
    expect(listing.keys[1]).toMatchObject({
      canReplace: false,
      canDelete: true,
    });
  });

  it("offers registered keys nobody saved, and says which can be tested", async () => {
    mocks.roles.set(`${ORG}:${ME}`, "member");
    registerRequiredSecret({
      key: "GITHUB_TOKEN",
      label: "GitHub token",
      scope: "user",
      kind: "api-key",
      validator: async () => true,
    });
    registerRequiredSecret({
      key: "SHARED_SERVICE_KEY",
      label: "Shared service key",
      scope: "workspace",
      kind: "api-key",
    });
    registerRequiredSecret({
      key: "LINEAR_API_KEY",
      label: "Linear API key",
      scope: "user",
      kind: "api-key",
    });
    put("user", ME, { key: "LINEAR_API_KEY", value: "fake-linear-5555" });

    const member = await listApiKeys({ email: ME, orgId: ORG });
    expect(member.addable.map((key) => key.name)).toEqual(["GITHUB_TOKEN"]);
    expect(member.keys[0]).toMatchObject({
      name: "LINEAR_API_KEY",
      label: "Linear API key",
      registered: true,
      canReplace: true,
      canTest: false,
    });

    mocks.roles.set(`${ORG}:${ME}`, "owner");
    const owner = await listApiKeys({ email: ME, orgId: ORG });
    expect(owner.addable.map((key) => key.name)).toEqual([
      "GITHUB_TOKEN",
      "SHARED_SERVICE_KEY",
    ]);
  });
});

describe("deleteApiKey", () => {
  it("deletes exactly the named personal row", async () => {
    put("user", ME, { key: "STRIPE_SECRET_KEY", value: "fake-stripe-5678" });
    put("workspace", `solo:${ME}`, {
      key: "STRIPE_SECRET_KEY",
      value: "fake-old-0000",
    });

    const result = await deleteApiKey(
      { email: ME, orgId: null },
      { name: "STRIPE_SECRET_KEY", scope: "user" },
    );

    expect(result).toEqual({
      status: "deleted",
      removed: ["STRIPE_SECRET_KEY"],
    });
    expect(mocks.deleted).toEqual([`user:${ME}:STRIPE_SECRET_KEY`]);
  });

  it("removes a provider's endpoint and older names at the same row", async () => {
    mocks.roles.set(`${ORG}:${ME}`, "admin");
    put("org", ORG, { key: "OPENAI_API_KEY", value: "fake-openai-9999" });
    put("org", ORG, { key: "OPENAI_BASE_URL", value: "https://gw.example" });

    const result = await deleteApiKey(
      { email: ME, orgId: ORG },
      { name: "OPENAI_API_KEY", scope: "org" },
    );

    expect(result).toEqual({
      status: "deleted",
      removed: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
    });
  });

  it("keeps a Vault-synced endpoint beside the provider key it deletes", async () => {
    mocks.roles.set(`${ORG}:${ME}`, "admin");
    put("org", ORG, { key: "OPENAI_API_KEY", value: "fake-openai-9999" });
    put("org", ORG, {
      key: "OPENAI_BASE_URL",
      value: "https://gw.example",
      description: `${VAULT_PREFIX} OPENAI_BASE_URL`,
    });

    const result = await deleteApiKey(
      { email: ME, orgId: ORG },
      { name: "OPENAI_API_KEY", scope: "org" },
    );

    expect(result).toEqual({ status: "deleted", removed: ["OPENAI_API_KEY"] });
    expect(mocks.deleted).toEqual([`org:${ORG}:OPENAI_API_KEY`]);
  });

  it("refuses organization keys for members, managed keys, and vault keys", async () => {
    mocks.roles.set(`${ORG}:${ME}`, "member");
    put("workspace", ORG, { key: "SHARED_WEBHOOK", value: "fake-hook-2222" });
    expect(
      await deleteApiKey(
        { email: ME, orgId: ORG },
        { name: "SHARED_WEBHOOK", scope: "org", storedScope: "workspace" },
      ),
    ).toMatchObject({ status: "forbidden" });

    put("user", ME, { key: "clips-calendar:google:1:refresh", value: "fake" });
    expect(
      await deleteApiKey(
        { email: ME, orgId: ORG },
        { name: "clips-calendar:google:1:refresh", scope: "user" },
      ),
    ).toMatchObject({ status: "managed", managedBy: { id: "meetings" } });

    mocks.roles.set(`${ORG}:${ME}`, "owner");
    put("org", ORG, {
      key: "FIGMA_ACCESS_TOKEN",
      value: "fake-figma-1111",
      description: `${VAULT_PREFIX} FIGMA_ACCESS_TOKEN`,
    });
    expect(
      await deleteApiKey(
        { email: ME, orgId: ORG },
        { name: "FIGMA_ACCESS_TOKEN", scope: "org" },
      ),
    ).toEqual({ status: "vault" });
    expect(mocks.deleted).toEqual([]);
  });

  it("reports a missing row as not found, never as deleted", async () => {
    expect(
      await deleteApiKey(
        { email: ME, orgId: null },
        { name: "NOPE", scope: "user" },
      ),
    ).toEqual({ status: "not-found" });
  });
});

describe("api key actions", () => {
  it("require a signed-in caller", async () => {
    await expect(listAction.run({}, {} as never)).rejects.toThrow(
      /Not authenticated/,
    );
    await expect(
      deleteAction.run({ name: "X", scope: "user" }, {} as never),
    ).rejects.toThrow(/Not authenticated/);
  });

  it("fail loudly when the key is missing or not the caller's to delete", async () => {
    mocks.roles.set(`${ORG}:${ME}`, "member");
    put("org", ORG, { key: "OPENAI_API_KEY", value: "fake-openai-9999" });
    const ctx = { userEmail: ME, orgId: ORG } as never;
    await expect(
      deleteAction.run({ name: "OPENAI_API_KEY", scope: "org" }, ctx),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      deleteAction.run({ name: "MISSING", scope: "user" }, ctx),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("deletes a personal key through the action", async () => {
    put("user", ME, { key: "STRIPE_SECRET_KEY", value: "fake-stripe-5678" });
    const result = await deleteAction.run(
      { name: "STRIPE_SECRET_KEY", scope: "user" },
      { userEmail: ME, orgId: null } as never,
    );
    expect(result).toEqual({ ok: true, removed: ["STRIPE_SECRET_KEY"] });
  });
});
