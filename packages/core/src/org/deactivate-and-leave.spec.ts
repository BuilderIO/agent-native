import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

const state = vi.hoisted(() => ({
  exec: undefined as DbExec | undefined,
  ctx: undefined as
    | { email: string; orgId: string; orgName: string; role: string }
    | undefined,
  activeOrgWrites: [] as Array<{ email: string; orgId: string | null }>,
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => state.exec! };
});
vi.mock("../audit/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../audit/store.js")>()),
  ensureAuditTables: vi.fn(async () => undefined),
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (handler: any) => handler,
  getRouterParam: () => undefined,
  getRequestURL: (event: any) => new URL(event._url),
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
}));
vi.mock("../server/h3-helpers.js", () => ({
  readBody: (event: any) => Promise.resolve(event._body),
}));
vi.mock("./context.js", () => ({
  getOrgContext: async () => state.ctx,
  createOrganization: vi.fn(),
  bootstrapAdminOrganization: vi.fn(),
  markActiveOrgSelectionChanged: vi.fn(),
}));
vi.mock("./active-org.js", () => ({
  setActiveOrgId: async (email: string, orgId: string | null) => {
    state.activeOrgWrites.push({ email, orgId });
  },
}));
vi.mock("./federation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./federation.js")>()),
  revokeFederatedOrganizationMember: vi.fn(async () => false),
}));
vi.mock("./track-invite-accepted.js", () => ({
  trackInviteAccepted: vi.fn(),
  registerBackgroundWork: vi.fn(),
}));

import { isOrgMemberOrInvited } from "../sharing/grant.js";
import { acceptPendingInvitationsForEmail } from "./accept-pending.js";
import {
  inviteOne,
  leaveOrgHandler,
  listDeactivatedMembersHandler,
  listInvitationsHandler,
  removeMemberHandler,
} from "./handlers.js";
import { isOrgMember } from "./membership.js";
import type { OrgDeactivatedMember } from "./types.js";

function pgliteExec(db: Awaited<ReturnType<typeof createTestPglite>>): DbExec {
  const toPg = (sql: string) => {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  };
  // raw-sql-ok: test DbExec adapter forwarding the handlers' already-bound statements to PGlite.
  const wrap = (client: {
    query: (sql: string, args?: unknown[]) => Promise<any>;
  }): DbExec => ({
    async execute(query) {
      const statement = typeof query === "string" ? { sql: query } : query;
      const result = await client.query(
        toPg(statement.sql),
        (statement.args ?? []).map((value) => value ?? null),
      );
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
  });
  const exec = wrap(db.db);
  exec.transaction = (run) =>
    db.db.transaction((tx: any) => run(wrap(tx) as any));
  return exec;
}

function event(path: string, body?: unknown) {
  return { _url: `https://app.example.test${path}`, _body: body } as any;
}

const OWNER = "owner@example.test";
const MEMBER = "member@example.test";

describe("deactivating and leaving an organization (real pglite)", () => {
  let pglite: Awaited<ReturnType<typeof createTestPglite>>;

  beforeEach(async () => {
    pglite = await createTestPglite();
    state.exec = pgliteExec(pglite);
    state.activeOrgWrites = [];
    await pglite.exec(`
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
      );
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        role TEXT NOT NULL, joined_at BIGINT NOT NULL,
        federation_removal_pending_at BIGINT
      );
      CREATE TABLE org_invitations (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        invited_by TEXT NOT NULL, created_at BIGINT NOT NULL,
        status TEXT NOT NULL, role TEXT, app_roles_json TEXT
      );
      CREATE TABLE agent_audit_log (
        id TEXT PRIMARY KEY, created_at BIGINT, action TEXT, caller TEXT,
        actor_kind TEXT, actor_email TEXT, org_id TEXT, target_type TEXT,
        target_id TEXT, status TEXT, summary TEXT, input TEXT,
        owner_email TEXT, visibility TEXT
      );
      INSERT INTO organizations (id, name, created_by, created_at) VALUES
        ('org-1', 'Acme', '${OWNER}', 1), ('org-2', 'Other', '${OWNER}', 1);
      INSERT INTO org_members VALUES
        ('m-1', 'org-1', '${OWNER}', 'owner', 1, NULL),
        ('m-2', 'org-1', '${MEMBER}', 'member', 2, NULL),
        ('m-3', 'org-2', '${OWNER}', 'owner', 1, NULL),
        ('m-4', 'org-2', '${MEMBER}', 'member', 3, NULL);
    `);
  });

  afterEach(async () => {
    await pglite.close();
  });

  it("a deactivated member stays listed but is denied membership, invitation and rejoin", async () => {
    state.ctx = {
      email: OWNER,
      orgId: "org-1",
      orgName: "Acme",
      role: "owner",
    };
    await removeMemberHandler(
      event(`/_agent-native/org/members/${MEMBER}`, {
        transferTo: OWNER,
        deactivate: true,
      }),
    );

    const deactivated: OrgDeactivatedMember = {
      email: MEMBER,
      role: "member",
      deactivatedAt: expect.any(Number),
    };
    expect(await listDeactivatedMembersHandler(event("/"))).toEqual({
      members: [deactivated],
    });
    expect(await isOrgMember("org-1", MEMBER)).toBe(false);
    expect(await isOrgMemberOrInvited("org-1", MEMBER)).toBe(false);
    expect(await listInvitationsHandler(event("/"))).toEqual({
      invitations: [],
    });
    expect((await acceptPendingInvitationsForEmail(MEMBER)).accepted).toEqual(
      [],
    );
    expect(await isOrgMember("org-1", MEMBER)).toBe(false);
  }, 30_000);

  it("deactivating cancels a pending invitation and an explicit re-invite lifts the deactivation", async () => {
    await pglite.exec(
      `INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status)
       VALUES ('inv-1', 'org-1', '${MEMBER}', '${OWNER}', 1, 'pending')`,
    );
    state.ctx = {
      email: OWNER,
      orgId: "org-1",
      orgName: "Acme",
      role: "owner",
    };
    await removeMemberHandler(
      event(`/_agent-native/org/members/${MEMBER}`, {
        transferTo: OWNER,
        deactivate: true,
      }),
    );
    const pending = await pglite.query(
      `SELECT 1 FROM org_invitations WHERE status = 'pending' AND email = '${MEMBER}'`,
    );
    expect(pending.rows).toEqual([]);
    expect((await acceptPendingInvitationsForEmail(MEMBER)).accepted).toEqual(
      [],
    );

    await inviteOne(
      { orgId: "org-1", orgName: "Acme", email: OWNER, role: "owner" },
      MEMBER,
      "member",
    );
    expect(await listDeactivatedMembersHandler(event("/"))).toEqual({
      members: [],
    });
    expect(await isOrgMemberOrInvited("org-1", MEMBER)).toBe(true);
  }, 30_000);

  it("a removal without deactivate leaves no Deactivated row", async () => {
    state.ctx = {
      email: OWNER,
      orgId: "org-1",
      orgName: "Acme",
      role: "owner",
    };
    await removeMemberHandler(
      event(`/_agent-native/org/members/${MEMBER}`, { transferTo: OWNER }),
    );

    expect(await listDeactivatedMembersHandler(event("/"))).toEqual({
      members: [],
    });
  }, 30_000);

  it("a member who leaves loses membership and only their own active org moves", async () => {
    state.ctx = {
      email: MEMBER,
      orgId: "org-1",
      orgName: "Acme",
      role: "member",
    };
    expect(await leaveOrgHandler(event("/_agent-native/org/leave"))).toEqual({
      success: true,
      orgId: "org-1",
      nextOrgId: "org-2",
    });

    expect(await isOrgMember("org-1", MEMBER)).toBe(false);
    expect(await isOrgMember("org-2", MEMBER)).toBe(true);
    expect(await isOrgMember("org-1", OWNER)).toBe(true);
    expect(state.activeOrgWrites).toEqual([{ email: MEMBER, orgId: "org-2" }]);
  }, 30_000);

  it("the owner cannot leave", async () => {
    state.ctx = {
      email: OWNER,
      orgId: "org-1",
      orgName: "Acme",
      role: "owner",
    };
    await expect(
      leaveOrgHandler(event("/_agent-native/org/leave")),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await isOrgMember("org-1", OWNER)).toBe(true);
  }, 30_000);

  it("a member cannot leave their only organization", async () => {
    await pglite.exec(`DELETE FROM org_members WHERE id = 'm-4'`);
    state.ctx = {
      email: MEMBER,
      orgId: "org-1",
      orgName: "Acme",
      role: "member",
    };
    await expect(
      leaveOrgHandler(event("/_agent-native/org/leave")),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await isOrgMember("org-1", MEMBER)).toBe(true);
  }, 30_000);

  it("a refused leave for lack of a successor does not mark the caller pending", async () => {
    await pglite.exec(
      `UPDATE org_members SET federation_removal_pending_at = 5 WHERE id = 'm-1'`,
    );
    state.ctx = {
      email: MEMBER,
      orgId: "org-1",
      orgName: "Acme",
      role: "member",
    };
    await expect(
      leaveOrgHandler(event("/_agent-native/org/leave")),
    ).rejects.toMatchObject({ statusCode: 409 });
    const row = await pglite.query<{ pending: string | null }>(
      `SELECT federation_removal_pending_at AS pending FROM org_members WHERE id = 'm-2'`,
    );
    expect(row.rows[0]?.pending).toBeNull();
    expect(await isOrgMember("org-1", MEMBER)).toBe(true);
  }, 30_000);
});
