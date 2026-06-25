/**
 * Tests for the per-resource sharing restrictions used by extensions:
 *
 *   - `allowPublic: false` — `set-resource-visibility` rejects `'public'`,
 *     and `accessFilter` / `resolveAccess` treat a stored `'public'` row as
 *     private (defense in depth against bad data).
 *   - `requireOrgMemberForUserShares: true` — `share-resource` rejects
 *     `principalType: "user"` shares whose principalId isn't an active member
 *     of the resource's org and isn't holding a pending invitation either.
 *
 * Extensions opt into both flags so a code-executing extension can never be
 * reached by an arbitrary authenticated user, and a malicious shared
 * extension can't re-share itself to an outsider email.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { table, text, ownableColumns } from "../db/schema.js";
import { runWithRequestContext } from "../server/request-context.js";
import { accessFilter, ForbiddenError, resolveAccess } from "./access.js";
import listResourceShares from "./actions/list-resource-shares.js";
import setResourceVisibility from "./actions/set-resource-visibility.js";
import shareResource from "./actions/share-resource.js";
import { registerShareableResource } from "./registry.js";
import { createSharesTable, type ShareRole } from "./schema.js";

vi.mock("../db/client.js", () => {
  return {
    getDbExec: () => sharedClient,
    isPostgres: () => false,
    getDialect: () => "sqlite",
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

const resourceType = "restricted-doc";
const ownerEmail = "owner+qa@example.com";
const orgId = "org-restricted";
const orgMemberEmail = "member+qa@example.com";
const invitedEmail = "invitee+qa@example.com";
const outsiderEmail = "outsider+qa@example.com";

const docs = table("restricted_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(),
});

const docShares = createSharesTable("restricted_doc_shares");

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE restricted_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE restricted_doc_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL
    );
    CREATE TABLE org_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      role TEXT NOT NULL DEFAULT 'member'
    );
    INSERT INTO org_members (id, org_id, email, role, joined_at)
      VALUES ('m1', '${orgId}', '${ownerEmail}', 'owner', 0),
             ('m2', '${orgId}', '${orgMemberEmail}', 'member', 0);
    INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status, role)
      VALUES ('i1', '${orgId}', '${invitedEmail}', '${ownerEmail}', 0, 'pending', 'member');
  `);
  db = drizzle(sqlite);

  // Point the framework `getDbExec()` mock at the same sqlite instance so
  // the share-resource org-membership lookup hits the seeded org_members /
  // org_invitations rows above.
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = sqlite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = stmt.all(...args) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };

  registerShareableResource({
    type: resourceType,
    resourceTable: docs,
    sharesTable: docShares,
    displayName: "Restricted Doc",
    titleColumn: "title",
    getDb: () => db,
    allowPublic: false,
    requireOrgMemberForUserShares: true,
  });
});

afterEach(() => {
  sqlite.close();
});

async function insertDoc(values: {
  id: string;
  visibility?: "private" | "org" | "public";
}) {
  await db.insert(docs).values({
    id: values.id,
    title: values.id,
    ownerEmail,
    orgId,
    visibility: values.visibility ?? "private",
  });
}

describe("allowPublic: false", () => {
  it("refuses set-resource-visibility('public') even for the owner", async () => {
    await insertDoc({ id: "doc-1" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-1",
          visibility: "public",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    // The DB column should still be private — the action must not have run.
    const rows = sqlite
      .prepare("SELECT visibility FROM restricted_docs WHERE id = ?")
      .all("doc-1") as Array<{ visibility: string }>;
    expect(rows[0]?.visibility).toBe("private");
  });

  it("still allows org and private visibility", async () => {
    await insertDoc({ id: "doc-2" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-2",
          visibility: "org",
        }),
      ).resolves.toEqual({ ok: true, visibility: "org" });
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-2",
          visibility: "private",
        }),
      ).resolves.toEqual({ ok: true, visibility: "private" });
    });
  });

  it("treats a stored public row as private in accessFilter and resolveAccess", async () => {
    await insertDoc({ id: "stale-public", visibility: "public" });

    await runWithRequestContext(
      { userEmail: outsiderEmail, orgId: "org-other" },
      async () => {
        const rows = await db
          .select()
          .from(docs)
          .where(
            accessFilter(docs, docShares, undefined, "viewer", {
              includePublic: true,
            }),
          );
        expect(rows).toEqual([]);
        await expect(
          resolveAccess(resourceType, "stale-public"),
        ).resolves.toBeNull();
      },
    );

    // The owner still sees their own row even though it's flagged public.
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const rows = await db
        .select()
        .from(docs)
        .where(accessFilter(docs, docShares));
      expect(rows.map((r) => r.id)).toEqual(["stale-public"]);
    });
  });

  it("exposes policy.allowPublic=false through list-resource-shares", async () => {
    await insertDoc({ id: "doc-policy" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const result = await listResourceShares.run({
        resourceType,
        resourceId: "doc-policy",
      });
      expect((result as any).policy).toEqual({
        allowPublic: false,
        requireOrgMemberForUserShares: true,
      });
    });
  });
});

describe("requireOrgMemberForUserShares: true", () => {
  it("refuses user shares to an email that isn't in the org and isn't invited", async () => {
    await insertDoc({ id: "doc-3" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-3",
          principalType: "user",
          principalId: outsiderEmail,
          role: "viewer",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    const shares = sqlite
      .prepare("SELECT * FROM restricted_doc_shares WHERE resource_id = ?")
      .all("doc-3");
    expect(shares).toEqual([]);
  });

  it("allows user shares to an active org member", async () => {
    await insertDoc({ id: "doc-4" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-4",
          principalType: "user",
          principalId: orgMemberEmail,
          role: "viewer",
          notify: false,
        }),
      ).resolves.toMatchObject({ updated: false });
    });
  });

  it("allows user shares to an email with a pending invitation", async () => {
    await insertDoc({ id: "doc-5" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-5",
          principalType: "user",
          principalId: invitedEmail,
          role: "viewer",
          notify: false,
        }),
      ).resolves.toMatchObject({ updated: false });
    });
  });

  it("refuses cross-org org-principal shares", async () => {
    // An extension shared to a different org would let that org's members
    // run code with the viewer's credentials — same threat model as a
    // public extension. Pin org-principal shares to the resource's own org.
    await insertDoc({ id: "doc-6" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-6",
          principalType: "org",
          principalId: "org-other",
          role: "viewer",
          notify: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("does not honor stale cross-org user share rows at read time", async () => {
    await insertDoc({ id: "doc-stale-user-share" });
    await db.insert(docShares).values({
      id: "stale-user-share",
      resourceId: "doc-stale-user-share",
      principalType: "user",
      principalId: outsiderEmail,
      role: "viewer",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    });

    await runWithRequestContext(
      { userEmail: outsiderEmail, orgId: "org-other" },
      async () => {
        const rows = await db
          .select()
          .from(docs)
          .where(accessFilter(docs, docShares));
        expect(rows).toEqual([]);
        await expect(
          resolveAccess(resourceType, "doc-stale-user-share"),
        ).resolves.toBeNull();
      },
    );
  });

  it("does not honor stale cross-org org share rows at read time", async () => {
    await insertDoc({ id: "doc-stale-org-share" });
    await db.insert(docShares).values({
      id: "stale-org-share",
      resourceId: "doc-stale-org-share",
      principalType: "org",
      principalId: "org-other",
      role: "viewer",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    });

    await runWithRequestContext(
      { userEmail: "other-member+qa@example.com", orgId: "org-other" },
      async () => {
        const rows = await db
          .select()
          .from(docs)
          .where(accessFilter(docs, docShares));
        expect(rows).toEqual([]);
        await expect(
          resolveAccess(resourceType, "doc-stale-org-share"),
        ).resolves.toBeNull();
      },
    );
  });

  it("allows org-principal shares to the resource's own org", async () => {
    await insertDoc({ id: "doc-6-self" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-6-self",
          principalType: "org",
          principalId: orgId,
          role: "viewer",
          notify: false,
        }),
      ).resolves.toMatchObject({ updated: false });
    });
  });

  it("refuses user shares when the resource has no org context", async () => {
    await db.insert(docs).values({
      id: "doc-no-org",
      title: "doc-no-org",
      ownerEmail,
      orgId: null,
      visibility: "private",
    });
    await runWithRequestContext({ userEmail: ownerEmail }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-no-org",
          principalType: "user",
          principalId: orgMemberEmail,
          role: "viewer",
          notify: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("refuses org-principal shares when the resource has no org context", async () => {
    await db.insert(docs).values({
      id: "doc-no-org-2",
      title: "doc-no-org-2",
      ownerEmail,
      orgId: null,
      visibility: "private",
    });
    await runWithRequestContext({ userEmail: ownerEmail }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-no-org-2",
          principalType: "org",
          principalId: orgId,
          role: "viewer",
          notify: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});

// Satisfy `noUnusedLocals` — used by drizzle's overload-resolution type narrowing.
export type _RoleType = ShareRole;
