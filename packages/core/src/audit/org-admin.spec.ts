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

const { defineAction } = await import("../action.js");
const {
  recordDefaultAgentEngineRefusal,
  resolveDefaultAgentEngineAuthority,
  writeDefaultAgentEngineSelection,
} = await import("../agent/default-agent-engine.js");
const { __resetAuditInitForTests } = await import("./store.js");
const { orgAdminAudit, recordOrgAdminAuditEvent } =
  await import("./org-admin.js");
const { resolveAuditReadScope } = await import("./read-scope.js");
const listAuditEvents = (await import("./actions/list-audit-events.js"))
  .default;
const getAuditEvent = (await import("./actions/get-audit-event.js")).default;

const ORG = "org-a";
const ADMIN = "admin@example.test";
const MEMBER = "member@example.test";
const OTHER_MEMBER = "other@example.test";
const admin = { userEmail: ADMIN, orgId: ORG };
const member = { userEmail: MEMBER, orgId: ORG };

async function addMember(email: string, role: string) {
  await pglite.query(
    `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
    [`${ORG}:${email}`, ORG, email, role, Date.now()],
  );
}

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetAuditInitForTests();
  process.env.AGENT_NATIVE_APP_ID = "mail";
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
  await addMember(ADMIN, "admin");
  await addMember(MEMBER, "member");
  await addMember(OTHER_MEMBER, "member");
});

afterEach(async () => {
  delete process.env.AGENT_NATIVE_APP_ID;
  await pglite.close();
  vi.clearAllMocks();
});

async function seedDefaultModelChanges() {
  const refused = await resolveDefaultAgentEngineAuthority(member);
  if (refused.allowed) throw new Error("expected a refusal");
  await recordDefaultAgentEngineRefusal(
    member,
    refused,
    "set",
    { actionName: "manage-agent-engine", caller: "frontend" },
    { engine: "ai-sdk:openai", model: "gpt-5.5" },
  );
  const allowed = await resolveDefaultAgentEngineAuthority(admin);
  if (!allowed.allowed) throw new Error("expected an admin");
  await writeDefaultAgentEngineSelection(
    allowed,
    { engine: "anthropic", model: "claude-sonnet-5" },
    { actionName: "manage-agent-engine", caller: "tool" },
  );
}

describe("organization audit log", () => {
  it("shows an admin a member's refused default-model change and an admin's change, with app and actor", async () => {
    await seedDefaultModelChanges();

    const result = await listAuditEvents.run({ scope: "organization" }, admin);

    expect(
      result.events.map((e) => ({
        status: e.status,
        actorEmail: e.actorEmail,
        actorKind: e.actorKind,
        app: e.app,
        targetType: e.targetType,
        summary: e.summary,
      })),
    ).toEqual([
      {
        status: "success",
        actorEmail: ADMIN,
        actorKind: "agent",
        app: "mail",
        targetType: "agent-default-model",
        summary: "Default model set to claude-sonnet-5 (anthropic)",
      },
      {
        status: "denied",
        actorEmail: MEMBER,
        actorKind: "human",
        app: "mail",
        targetType: "agent-default-model",
        summary: "Refused a default model change",
      },
    ]);
    expect(result).toMatchObject({ hasMore: false, nextOffset: null });

    const detail = await getAuditEvent.run({ id: result.events[1].id }, admin);
    expect(detail.event?.input).toContain("gpt-5.5");
  });

  it("lets a member read only their own events", async () => {
    await seedDefaultModelChanges();

    const own = await listAuditEvents.run({}, member);
    expect(own.events.map((e) => [e.actorEmail, e.status])).toEqual([
      [MEMBER, "denied"],
    ]);
    const other = await listAuditEvents.run(
      {},
      { userEmail: OTHER_MEMBER, orgId: ORG },
    );
    expect(other.events).toEqual([]);

    const adminRow = (
      await listAuditEvents.run({ scope: "organization" }, admin)
    ).events.find((e) => e.actorEmail === ADMIN);
    expect(
      (await getAuditEvent.run({ id: adminRow!.id }, member)).event,
    ).toBeNull();
  });

  it("refuses the organization trail to members and to callers without an org", async () => {
    await expect(
      listAuditEvents.run({ scope: "organization" }, member),
    ).rejects.toMatchObject({
      statusCode: 403,
      message:
        "Only organization owners and admins can read the organization audit log.",
    });
    await expect(
      listAuditEvents.run({ scope: "organization" }, { userEmail: ADMIN }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("filters the trail by app and date range and pages with offset", async () => {
    for (const [app, at] of [
      ["mail", 1_000],
      ["clips", 2_000],
      ["mail", 3_000],
      ["mail", 4_000],
    ] as const) {
      process.env.AGENT_NATIVE_APP_ID = app;
      vi.spyOn(Date, "now").mockReturnValueOnce(at);
      await recordOrgAdminAuditEvent({
        action: "change-member-role",
        targetType: "org-member-role",
        targetId: MEMBER,
        summary: `change at ${at}`,
        userEmail: ADMIN,
        orgId: ORG,
      });
    }

    const mail = await listAuditEvents.run(
      { scope: "organization", app: "mail", sinceMs: 1_000, beforeMs: 4_000 },
      admin,
    );
    expect(mail.events.map((e) => e.createdAt)).toEqual([3_000, 1_000]);

    const first = await listAuditEvents.run(
      { scope: "organization", limit: 3 },
      admin,
    );
    expect(first).toMatchObject({ count: 3, hasMore: true, nextOffset: 3 });
    const rest = await listAuditEvents.run(
      { scope: "organization", limit: 3, offset: first.nextOffset! },
      admin,
    );
    expect(rest.events.map((e) => e.createdAt)).toEqual([1_000]);
    expect(rest.hasMore).toBe(false);
  });

  it("records a refused settings action as denied and shows it to admins only", async () => {
    const setThing = defineAction({
      description: "Change an org setting",
      audit: orgAdminAudit({
        targetType: "org-thing",
        targetId: () => ORG,
        summary: (_args, _result, meta) =>
          meta.status === "success" ? "Changed the thing" : "Refused a change",
      }),
      run: async (_args: Record<string, never>, ctx) => {
        if (ctx?.userEmail !== ADMIN) {
          throw Object.assign(new Error("Owners and admins only."), {
            statusCode: 403,
          });
        }
        return { ok: true };
      },
    });

    await expect(
      setThing.run(
        {},
        { ...member, caller: "frontend", actionName: "set-thing" },
      ),
    ).rejects.toThrow("Owners and admins only.");
    await setThing.run(
      {},
      { ...admin, caller: "tool", actionName: "set-thing" },
    );

    const trail = await listAuditEvents.run({ scope: "organization" }, admin);
    expect(
      trail.events.map((e) => [
        e.actorEmail,
        e.status,
        e.summary,
        e.visibility,
      ]),
    ).toEqual([
      [ADMIN, "success", "Changed the thing", "admins"],
      [MEMBER, "denied", "Refused a change", "admins"],
    ]);
    const other = await listAuditEvents.run(
      {},
      { userEmail: OTHER_MEMBER, orgId: ORG },
    );
    expect(other.events).toEqual([]);
  });

  it("keeps a member's personal change out of the organization trail", async () => {
    await recordOrgAdminAuditEvent({
      action: "builder-connect",
      targetType: "builder-connection",
      targetId: MEMBER,
      summary: "Connected a personal Builder.io account",
      userEmail: MEMBER,
      orgId: ORG,
      personal: true,
    });

    expect(
      (await listAuditEvents.run({ scope: "organization" }, admin)).events,
    ).toEqual([]);
    expect(
      (await listAuditEvents.run({}, member)).events.map((e) => e.visibility),
    ).toEqual(["private"]);
  });
});

describe("resolveAuditReadScope", () => {
  it("widens only for owners and admins of the active org", async () => {
    await expect(resolveAuditReadScope(admin)).resolves.toMatchObject({
      orgAdmin: true,
    });
    await expect(resolveAuditReadScope(member)).resolves.toMatchObject({
      orgAdmin: false,
    });
    await expect(
      resolveAuditReadScope({ userEmail: ADMIN, orgId: "org-b" }),
    ).resolves.toMatchObject({ orgAdmin: false });
  });

  it("treats missing org tables as no org admin", async () => {
    await pglite.exec(`DROP TABLE org_members`);
    await expect(resolveAuditReadScope(admin)).resolves.toMatchObject({
      orgAdmin: false,
    });
  });

  it("surfaces a membership read failure instead of reading it as a member", async () => {
    await pglite.exec(`DROP TABLE org_members`);
    await pglite.exec(`CREATE TABLE org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL
    )`);
    await expect(resolveAuditReadScope(admin)).rejects.toThrow(
      /federation_removal_pending_at/,
    );
  });
});
