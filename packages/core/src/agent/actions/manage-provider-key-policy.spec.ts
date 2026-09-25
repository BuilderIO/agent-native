import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

// Real PGlite behind getDbExec, so the member and stored-key queries run their
// genuine SQL. Settings are an in-memory map; the settings table's own DDL is
// covered elsewhere.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const mocks = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  personalOAuth: new Set<string>(),
  recordActionAudit: vi.fn(async (_input: unknown) => {}),
}));

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const rows = await pglite
        .prepare(input.sql)
        .all(...((input.args ?? []) as unknown[]));
      return { rows, rowsAffected: 0 };
    },
  }),
}));

vi.mock("../../settings/store.js", () => ({
  getSetting: async (key: string) => mocks.settings.get(key) ?? null,
  putSetting: async (key: string, value: Record<string, unknown>) => {
    mocks.settings.set(key, value);
  },
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

vi.mock("../../secrets/storage.js", () => ({
  ensureTable: async () => {},
}));

vi.mock("../../server/builder-oauth.js", () => ({
  hasStoredBuilderOAuthGrant: async (email: string, scope: string) =>
    scope === "user" && mocks.personalOAuth.has(email),
}));

vi.mock("../../audit/record.js", () => ({
  recordActionAudit: mocks.recordActionAudit,
}));

const { default: action } = await import("./manage-provider-key-policy.js");
const { isPersonalProviderKeyUseRestricted } =
  await import("../../server/personal-provider-key-policy.js");

const ORG = "org-1";
const OWNER = "owner@example.com";
const ADMIN = "admin@example.com";
const MEMBER = "member@example.com";
const QUIET_MEMBER = "quiet@example.com";

function ctx(userEmail: string) {
  return {
    caller: "tool" as const,
    actionName: "manage-provider-key-policy",
    userEmail,
    orgId: ORG,
  };
}

beforeAll(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`CREATE TABLE org_members (
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await pglite.exec(`CREATE TABLE app_secrets (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    key TEXT NOT NULL,
    encrypted_value TEXT NOT NULL
  )`);
  const members: Array<[string, string]> = [
    [OWNER, "owner"],
    [ADMIN, "admin"],
    [MEMBER, "member"],
    [QUIET_MEMBER, "member"],
  ];
  for (const [email, role] of members) {
    await pglite.query(
      "INSERT INTO org_members (org_id, email, role) VALUES (?, ?, ?)",
      [ORG, email, role],
    );
  }
  const secrets: Array<[string, string, string]> = [
    ["user", MEMBER, "ANTHROPIC_API_KEY"],
    ["user", "Member@Example.com", "OPENAI_API_KEY"],
    ["workspace", `solo:${MEMBER}`, "OPENAI_BASE_URL"],
    ["user", MEMBER, "NOTION_TOKEN"],
    ["user", ADMIN, "ANTHROPIC_API_KEY"],
    ["org", ORG, "ANTHROPIC_API_KEY"],
  ];
  let id = 0;
  for (const [scope, scopeId, key] of secrets) {
    await pglite.query(
      "INSERT INTO app_secrets (id, scope, scope_id, key, encrypted_value) VALUES (?, ?, ?, ?, 'ciphertext')",
      [`s${++id}`, scope, scopeId, key],
    );
  }
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(() => {
  mocks.settings.clear();
  mocks.personalOAuth.clear();
  mocks.recordActionAudit.mockClear();
});

describe("manage-provider-key-policy", () => {
  it("lets an admin preview who is affected before turning it on", async () => {
    mocks.personalOAuth.add(QUIET_MEMBER);

    const status = await action.run({}, ctx(ADMIN));

    expect(status).toEqual({
      restricted: false,
      canManage: true,
      updatedAt: null,
      updatedBy: null,
      affectedMembers: [
        {
          email: MEMBER,
          providers: [
            {
              provider: "anthropic",
              label: "Anthropic",
              keys: ["ANTHROPIC_API_KEY"],
            },
            {
              provider: "openai",
              label: "OpenAI",
              keys: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
            },
          ],
          builder: false,
        },
        { email: QUIET_MEMBER, providers: [], builder: true },
      ],
    });
    // Reading records nothing.
    expect(mocks.recordActionAudit).not.toHaveBeenCalled();
  });

  it("shows members the setting without the member list", async () => {
    await expect(action.run({}, ctx(MEMBER))).resolves.toEqual({
      restricted: false,
      canManage: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("restricts members, keeps owners and admins, and audits the change", async () => {
    const status = await action.run({ set: true }, ctx(OWNER));

    expect(status).toMatchObject({
      restricted: true,
      canManage: true,
      updatedBy: OWNER,
      changed: true,
    });
    expect(status.affectedMembers?.map((m) => m.email)).toEqual([MEMBER]);
    await expect(
      isPersonalProviderKeyUseRestricted({ email: MEMBER, orgId: ORG }),
    ).resolves.toBe(true);
    await expect(
      isPersonalProviderKeyUseRestricted({ email: ADMIN, orgId: ORG }),
    ).resolves.toBe(false);
    await expect(
      isPersonalProviderKeyUseRestricted({ email: OWNER, orgId: ORG }),
    ).resolves.toBe(false);
    expect(mocks.recordActionAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordActionAudit.mock.calls[0]?.[0]).toMatchObject({
      status: "success",
      args: { set: true },
      ctx: { actionName: "manage-provider-key-policy", userEmail: OWNER },
    });

    // Setting the same value again changes nothing and records nothing.
    await expect(action.run({ set: true }, ctx(ADMIN))).resolves.toMatchObject({
      restricted: true,
      changed: false,
    });
    expect(mocks.recordActionAudit).toHaveBeenCalledTimes(1);

    // Turning it off restores the member's keys; none were deleted.
    await expect(action.run({ set: false }, ctx(ADMIN))).resolves.toMatchObject(
      { restricted: false, changed: true },
    );
    await expect(
      isPersonalProviderKeyUseRestricted({ email: MEMBER, orgId: ORG }),
    ).resolves.toBe(false);
    const { rows } = await pglite.query(
      "SELECT key FROM app_secrets WHERE scope = 'user' AND scope_id = ?",
      [MEMBER],
    );
    expect(rows).toHaveLength(2);
  });

  it("refuses a member's change and audits the attempt", async () => {
    await expect(action.run({ set: true }, ctx(MEMBER))).rejects.toMatchObject({
      errorCode: "provider_key_policy_admin_required",
      statusCode: 403,
      message:
        "Only organization owners and admins can restrict personal API keys.",
    });
    expect(mocks.settings.size).toBe(0);
    expect(mocks.recordActionAudit.mock.calls[0]?.[0]).toMatchObject({
      status: "denied",
      ctx: { userEmail: MEMBER },
    });
  });

  it("needs a signed-in caller in an organization", async () => {
    await expect(
      action.run({}, { caller: "tool", orgId: ORG }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      action.run({}, { caller: "tool", userEmail: MEMBER }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
