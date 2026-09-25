import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => unknown) => fn(),
}));

const {
  clearDefaultAgentEngineSelection,
  readDefaultAgentEngineSettingDetailed,
  recordDefaultAgentEngineRefusal,
  resolveDefaultAgentEngineAuthority,
  writeDefaultAgentEngineSelection,
} = await import("./default-agent-engine.js");
const { putSetting, getSetting } = await import("../settings/store.js");
const { __resetAuditInitForTests } = await import("../audit/store.js");

const ORG_A = "org-a";
const ORG_B = "org-b";
const meta = { actionName: "manage-agent-engine", caller: "frontend" as const };

async function addMember(orgId: string, email: string, role: string) {
  await pglite.query(
    `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
    [`${orgId}:${email}`, orgId, email, role, Date.now()],
  );
}

async function auditRows() {
  const { rows } = await pglite.query(
    `SELECT action, caller, actor_email, org_id, target_type, target_id, status, visibility FROM agent_audit_log ORDER BY created_at`,
  );
  return rows as Array<Record<string, unknown>>;
}

async function adminAuthority(orgId: string, email: string) {
  const authority = await resolveDefaultAgentEngineAuthority({
    userEmail: email,
    orgId,
  });
  if (!authority.allowed) throw new Error("expected an allowed authority");
  return authority;
}

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetAuditInitForTests();
  await pglite.exec(`CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  await pglite.exec(`CREATE TABLE org_members (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await addMember(ORG_A, "admin-a@example.test", "admin");
  await addMember(ORG_A, "member-a@example.test", "member");
  await addMember(ORG_B, "owner-b@example.test", "owner");
});

afterEach(async () => {
  await pglite.close();
  vi.clearAllMocks();
});

describe("default model scope", () => {
  it("an org A admin's change leaves org B's default alone", async () => {
    await writeDefaultAgentEngineSelection(
      await adminAuthority(ORG_B, "owner-b@example.test"),
      { engine: "anthropic", model: "claude-sonnet-5" },
      meta,
    );
    await writeDefaultAgentEngineSelection(
      await adminAuthority(ORG_A, "admin-a@example.test"),
      { engine: "ai-sdk:openai", model: "gpt-5.5" },
      meta,
    );

    const a = await readDefaultAgentEngineSettingDetailed({
      userEmail: "member-a@example.test",
      orgId: ORG_A,
    });
    const b = await readDefaultAgentEngineSettingDetailed({
      userEmail: "owner-b@example.test",
      orgId: ORG_B,
    });
    expect(a.source).toBe("org");
    expect(a.value).toMatchObject({
      engine: "ai-sdk:openai",
      model: "gpt-5.5",
    });
    expect(b.source).toBe("org");
    expect(b.value).toMatchObject({
      engine: "anthropic",
      model: "claude-sonnet-5",
    });
    // Nothing writes the deployment-wide row any more.
    expect(await getSetting("agent-engine")).toBeNull();
  });

  it("only owners and admins may change an organization's default", async () => {
    await expect(
      resolveDefaultAgentEngineAuthority({
        userEmail: "member-a@example.test",
        orgId: ORG_A,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "not-admin",
      message:
        "Only organization owners and admins can change the default model.",
    });
    await expect(
      resolveDefaultAgentEngineAuthority({
        userEmail: "owner-b@example.test",
        orgId: ORG_A,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "not-admin" });
    await expect(
      resolveDefaultAgentEngineAuthority({ orgId: ORG_A }),
    ).resolves.toMatchObject({ allowed: false, reason: "unauthenticated" });
    await expect(
      resolveDefaultAgentEngineAuthority({
        userEmail: "admin-a@example.test",
        orgId: ORG_A,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "org", orgId: ORG_A });
  });

  it("keeps the legacy deployment-wide default until an org saves its own", async () => {
    await putSetting("agent-engine", {
      engine: "anthropic",
      model: "claude-legacy",
    });

    const before = await readDefaultAgentEngineSettingDetailed({
      userEmail: "admin-a@example.test",
      orgId: ORG_A,
    });
    expect(before).toEqual({
      source: "legacy",
      value: { engine: "anthropic", model: "claude-legacy" },
    });

    await writeDefaultAgentEngineSelection(
      await adminAuthority(ORG_A, "admin-a@example.test"),
      { engine: "ai-sdk:openai", model: "gpt-5.5" },
      meta,
    );

    expect(
      (
        await readDefaultAgentEngineSettingDetailed({
          userEmail: "admin-a@example.test",
          orgId: ORG_A,
        })
      ).value,
    ).toMatchObject({ engine: "ai-sdk:openai" });
    expect(
      await readDefaultAgentEngineSettingDetailed({
        userEmail: "owner-b@example.test",
        orgId: ORG_B,
      }),
    ).toEqual({
      source: "legacy",
      value: { engine: "anthropic", model: "claude-legacy" },
    });
    // The legacy row is kept, not deleted (additive upgrade).
    expect(await getSetting("agent-engine")).toEqual({
      engine: "anthropic",
      model: "claude-legacy",
    });
  });

  it("clearing an org's default stops the legacy fallback for that org only", async () => {
    await putSetting("agent-engine", { engine: "anthropic", model: "legacy" });

    await clearDefaultAgentEngineSelection(
      await adminAuthority(ORG_A, "admin-a@example.test"),
      meta,
    );

    expect(
      await readDefaultAgentEngineSettingDetailed({
        userEmail: "member-a@example.test",
        orgId: ORG_A,
      }),
    ).toEqual({ source: "org", value: null });
    expect(
      (
        await readDefaultAgentEngineSettingDetailed({
          userEmail: "owner-b@example.test",
          orgId: ORG_B,
        })
      ).source,
    ).toBe("legacy");
  });

  it("a signed-in user with no organization keeps their own default", async () => {
    const authority = await resolveDefaultAgentEngineAuthority({
      userEmail: "Solo@Example.test",
    });
    expect(authority).toMatchObject({ allowed: true, scope: "user" });
    if (!authority.allowed) throw new Error("unreachable");

    await writeDefaultAgentEngineSelection(
      authority,
      { engine: "ai-sdk:google", model: "gemini-3-1-pro" },
      meta,
    );

    expect(
      await readDefaultAgentEngineSettingDetailed({
        userEmail: "solo@example.test",
      }),
    ).toMatchObject({ source: "user", value: { engine: "ai-sdk:google" } });
    expect(
      (
        await readDefaultAgentEngineSettingDetailed({
          userEmail: "other@example.test",
        })
      ).source,
    ).toBe("none");
  });

  it("records changes and refused attempts as org-visible audit events", async () => {
    const ctx = { userEmail: "member-a@example.test", orgId: ORG_A };
    const refused = await resolveDefaultAgentEngineAuthority(ctx);
    if (refused.allowed) throw new Error("expected a refusal");
    await recordDefaultAgentEngineRefusal(ctx, refused, "set", meta, {
      engine: "ai-sdk:openai",
      model: "gpt-5.5",
    });
    await writeDefaultAgentEngineSelection(
      await adminAuthority(ORG_A, "admin-a@example.test"),
      { engine: "ai-sdk:openai", model: "gpt-5.5" },
      { actionName: "manage-agent-engine", caller: "tool" },
    );

    expect(await auditRows()).toEqual([
      {
        action: "manage-agent-engine",
        caller: "frontend",
        actor_email: "member-a@example.test",
        org_id: ORG_A,
        target_type: "agent-default-model",
        target_id: ORG_A,
        status: "denied",
        visibility: "org",
      },
      {
        action: "manage-agent-engine",
        caller: "tool",
        actor_email: "admin-a@example.test",
        org_id: ORG_A,
        target_type: "agent-default-model",
        target_id: ORG_A,
        status: "success",
        visibility: "org",
      },
    ]);
  });
});
