import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { withDbExec, type DbExec } from "../db/client.js";
import { table, text, ownableColumns } from "../db/schema.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import { runWithRequestContext } from "../server/request-context.js";
import { resolveAccess } from "./access.js";
import { resolveAccessMany } from "./index.js";
import { registerShareableResource } from "./registry.js";
import { createSharesTable } from "./schema.js";

const resourceType = "qa-batch-app";
const ownerEmail = "owner+qa@example.com";
const viewerEmail = "viewer+qa@example.com";
const adminEmail = "admin+qa@example.com";
const outsiderEmail = "outsider+qa@example.com";
const otherMemberEmail = "other-member+qa@example.com";
const orgId = "org-qa";

const apps = table("qa_batch_apps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ...ownableColumns(),
});
const appShares = createSharesTable("qa_batch_app_shares");

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let statements: string[] = [];

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

const countingExec: DbExec = {
  execute: async (input) => {
    const sql = typeof input === "string" ? input : input.sql;
    statements.push(sql);
    const result = await pglite.db.query(
      postgresSql(sql),
      typeof input === "string" ? [] : (input.args ?? []).map((v) => v ?? null),
    );
    return { rows: result.rows as any[], rowsAffected: 0 };
  },
};

const countingDb = drizzleProxy(async (query, params) => {
  statements.push(query);
  const result = await pglite.db.query(query, params as unknown[], {
    rowMode: "array",
  });
  return { rows: result.rows as any[] };
});

async function seedApps(count: number) {
  await pglite.query(
    `INSERT INTO organizations (id, name, created_by, created_at)
     VALUES (?, 'QA', ?, 0)`,
    [orgId, ownerEmail],
  );
  await pglite.query(
    `INSERT INTO org_members (id, org_id, email, role, joined_at)
     VALUES ('m-owner', ?, ?, 'owner', 0), ('m-viewer', ?, ?, 'member', 0),
            ('m-admin', ?, ?, 'admin', 0), ('m-other', ?, ?, 'member', 0)`,
    [
      orgId,
      ownerEmail,
      orgId,
      viewerEmail,
      orgId,
      adminEmail,
      orgId,
      otherMemberEmail,
    ],
  );
  await pglite.query(
    `INSERT INTO workspace_user_groups
       (id, org_id, name, member_emails_json)
     VALUES ('group-1', ?, 'Group', ?)`,
    [orgId, JSON.stringify([viewerEmail])],
  );
  // Half are org-visible; the rest are private, and of those a few are
  // shared to the viewer directly, through the org, or through a group.
  for (let i = 0; i < count; i++) {
    const id = `app-${i}`;
    const visibility = i % 2 === 0 ? "org" : "private";
    await pglite.query(
      `INSERT INTO qa_batch_apps (id, name, owner_email, org_id, visibility)
       VALUES (?, ?, ?, ?, ?)`,
      [id, id, ownerEmail, orgId, visibility],
    );
    const share =
      i % 8 === 1
        ? (["user", viewerEmail] as const)
        : i % 8 === 3
          ? (["org", orgId] as const)
          : i % 8 === 5
            ? (["group", "group-1"] as const)
            : null;
    if (share) {
      await pglite.query(
        `INSERT INTO qa_batch_app_shares
           (id, resource_id, principal_type, principal_id, role, created_by, created_at)
         VALUES (?, ?, ?, ?, 'viewer', ?, '2026-01-01')`,
        [`share-${i}`, id, share[0], share[1], ownerEmail],
      );
    }
  }
}

beforeEach(async () => {
  statements = [];
  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE qa_batch_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE qa_batch_app_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      identity_authority TEXT,
      identity_id TEXT
    );
    CREATE TABLE org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      federation_removal_pending_at INTEGER
    );
    CREATE TABLE workspace_user_groups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      member_emails_json TEXT NOT NULL DEFAULT '[]',
      created_by_email TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
    );
  `);
  // Same shape as Dispatch's `workspace-app` registration.
  registerShareableResource({
    type: resourceType,
    resourceTable: apps,
    sharesTable: appShares,
    displayName: "Workspace app",
    titleColumn: "name",
    getDb: () => countingDb,
    allowPublic: false,
    requireOrgMemberForUserShares: true,
    canManageAccessKey: (resource) => resource?.orgId ?? undefined,
    supportsGroupShares: true,
    canManageAccess: async (resource, ctx) => {
      if (!ctx.userEmail || !ctx.orgId || resource?.orgId !== ctx.orgId) {
        return false;
      }
      const role = await readOrgMemberRole(ctx.orgId, ctx.userEmail);
      return role === "owner" || role === "admin";
    },
  });
});

afterEach(async () => {
  await pglite.close();
});

type Viewer = { userEmail: string; orgId?: string };

async function perAppVisible(viewer: Viewer, count: number) {
  const visible: string[] = [];
  await withDbExec(countingExec, () =>
    runWithRequestContext(viewer, async () => {
      for (let i = 0; i < count; i++) {
        const access = await resolveAccess(resourceType, `app-${i}`, viewer, {
          skipResourceBody: true,
        });
        if (access) visible.push(`app-${i}`);
      }
    }),
  );
  return visible.sort();
}

async function manyVisible(viewer: Viewer, count: number) {
  const ids = Array.from({ length: count }, (_, i) => `app-${i}`);
  return withDbExec(countingExec, () =>
    runWithRequestContext(viewer, () =>
      resolveAccessMany(resourceType, ids, viewer, { skipResourceBody: true }),
    ),
  );
}

const viewers: Record<string, Viewer> = {
  "org member": { userEmail: viewerEmail, orgId },
  "org admin": { userEmail: adminEmail, orgId },
  owner: { userEmail: ownerEmail, orgId },
  "org member without an active org": { userEmail: viewerEmail },
  outsider: { userEmail: outsiderEmail, orgId },
};

describe("resolveAccessMany", () => {
  for (const [label, viewer] of Object.entries(viewers)) {
    it(`opens the same apps as one resolveAccess per app: ${label}`, async () => {
      await seedApps(30);
      const expected = await perAppVisible(viewer, 30);
      const resolved = await manyVisible(viewer, 30);
      expect([...resolved.keys()].sort()).toEqual(expected);
      for (const [id, access] of resolved) {
        const single = await withDbExec(countingExec, () =>
          resolveAccess(resourceType, id, viewer, { skipResourceBody: true }),
        );
        expect(access.role).toBe(single?.role);
      }
    });
  }

  it("opens exactly the apps shared with the viewer, and no others", async () => {
    await seedApps(30);
    const resolved = await manyVisible(viewers["org member"], 30);
    // Even apps are org-visible; odd ones are private, and every odd app but
    // those ending in 7 (mod 8) is shared by user, org, or group.
    const expected = Array.from({ length: 30 }, (_, i) => i)
      .filter((i) => i % 2 === 0 || i % 8 !== 7)
      .map((i) => `app-${i}`)
      .sort();
    expect([...resolved.keys()].sort()).toEqual(expected);
  });

  it("does not open a group share to a member outside the group", async () => {
    await seedApps(30);
    const resolved = await manyVisible(
      { userEmail: otherMemberEmail, orgId },
      30,
    );
    expect(resolved.has("app-3")).toBe(true);
    expect(resolved.has("app-5")).toBe(false);
    expect(resolved.has("app-1")).toBe(false);
  });

  it("opens nothing for an empty list or a signed-out viewer", async () => {
    await seedApps(4);
    const [none, signedOut] = await withDbExec(countingExec, () =>
      Promise.all([
        resolveAccessMany(resourceType, [], { userEmail: ownerEmail, orgId }),
        resolveAccessMany(resourceType, ["app-0", "app-1"], {}),
      ]),
    );
    expect(none.size).toBe(0);
    expect(signedOut.size).toBe(0);
  });

  it("leaves out ids that do not exist", async () => {
    await seedApps(4);
    const resolved = await withDbExec(countingExec, () =>
      resolveAccessMany(
        resourceType,
        ["app-0", "missing-app"],
        { userEmail: ownerEmail, orgId },
        { skipResourceBody: true },
      ),
    );
    expect([...resolved.keys()]).toEqual(["app-0"]);
  });

  it("reads a constant number of rows however many apps it is asked about", async () => {
    const queryCounts: Record<number, { perApp: number; many: number }> = {};
    for (const count of [10, 30]) {
      await pglite.exec(
        "DELETE FROM qa_batch_apps; DELETE FROM qa_batch_app_shares; DELETE FROM org_members; DELETE FROM organizations; DELETE FROM workspace_user_groups;",
      );
      await seedApps(count);
      statements = [];
      await perAppVisible(viewers["org member"], count);
      const perApp = statements.length;
      statements = [];
      await manyVisible(viewers["org member"], count);
      queryCounts[count] = { perApp, many: statements.length };
    }
    expect(queryCounts[30].many).toBe(queryCounts[10].many);
    expect(queryCounts[30].many).toBeLessThan(queryCounts[30].perApp / 5);
  });
});
