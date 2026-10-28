import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
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
    getScopedDbExec: () => undefined,
    isProductionServerlessFunctionRuntime: () => false,
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

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`
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
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
    CREATE TABLE org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at BIGINT NOT NULL,
      federation_removal_pending_at INTEGER
    );
    CREATE TABLE org_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      role TEXT NOT NULL DEFAULT 'member'
    );
    INSERT INTO org_members (id, org_id, email, role, joined_at)
      VALUES ('m1', '${orgId}', '${ownerEmail}', 'owner', 0),
             ('m2', '${orgId}', '${orgMemberEmail}', 'member', 0);
    INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status, role)
      VALUES ('i1', '${orgId}', '${invitedEmail}', '${ownerEmail}', 0, 'pending', 'member');
  `);
  db = drizzle(pglite.db);

  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = await pglite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
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

afterEach(async () => {
  await pglite.close();
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

    const rows = (await pglite
      .prepare("SELECT visibility FROM restricted_docs WHERE id = ?")
      .all("doc-1")) as Array<{ visibility: string }>;
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
      ).resolves.toMatchObject({ ok: true, visibility: "org" });
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-2",
          visibility: "private",
        }),
      ).resolves.toMatchObject({ ok: true, visibility: "private" });
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
      expect((result as any).agentReadable).toBe(false);
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

    const shares = await pglite
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

describe("assertSharingChange", () => {
  const refusal = "This doc is held for review.";
  const raceRefusal = "A context item landed while this doc was being shared.";
  let seen: Array<{ id: string; change: unknown }>;

  beforeEach(async () => {
    seen = [];
    registerShareableResource({
      type: resourceType,
      resourceTable: docs,
      sharesTable: docShares,
      displayName: "Restricted Doc",
      titleColumn: "title",
      getDb: () => db,
      allowPublic: true,
      requireOrgMemberForUserShares: true,
      assertSharingChange: ({ resource, change }) => {
        seen.push({ id: resource.id, change });
        if (resource.id === "doc-guarded") throw new ForbiddenError(refusal);
        // A "doc-raced" change passes its first call, the check before the
        // write. The second call, after the write, stands in for a context
        // item that committed in between, so it refuses.
        if (
          resource.id.startsWith("doc-raced") &&
          seen.filter((s) => s.id === resource.id).length > 1
        ) {
          throw new ForbiddenError(raceRefusal);
        }
      },
    });
    await insertDoc({ id: "doc-guarded" });
    await insertDoc({ id: "doc-open" });
  });

  it("refuses an org or public visibility change the hook rejects", async () => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-guarded",
          visibility: "org",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-guarded",
          visibility: "public",
        }),
      ).rejects.toThrow(refusal);
    });

    const rows = (await pglite
      .prepare("SELECT visibility FROM restricted_docs WHERE id = ?")
      .all("doc-guarded")) as Array<{ visibility: string }>;
    expect(rows[0]?.visibility).toBe("private");
  });

  it("passes the row and change kind, and skips the hook when visibility is unchanged", async () => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await setResourceVisibility.run({
        resourceType,
        resourceId: "doc-open",
        visibility: "org",
      });
      await setResourceVisibility.run({
        resourceType,
        resourceId: "doc-open",
        visibility: "org",
      });
      await setResourceVisibility.run({
        resourceType,
        resourceId: "doc-guarded",
        visibility: "private",
      });
    });

    // Each change is checked before and after its write.
    expect(seen).toEqual([
      { id: "doc-open", change: { kind: "visibility", visibility: "org" } },
      { id: "doc-open", change: { kind: "visibility", visibility: "org" } },
    ]);
  });

  it("refuses a share grant the hook rejects before writing a share row", async () => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-guarded",
          principalType: "user",
          principalId: orgMemberEmail,
          role: "viewer",
          notify: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    const shares = await pglite
      .prepare("SELECT * FROM restricted_doc_shares WHERE resource_id = ?")
      .all("doc-guarded");
    expect(shares).toEqual([]);
    expect(seen).toEqual([{ id: "doc-guarded", change: { kind: "grant" } }]);
  });

  it("allows a share grant and visibility change the hook accepts", async () => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-open",
          principalType: "user",
          principalId: orgMemberEmail,
          role: "viewer",
          notify: false,
        }),
      ).resolves.toMatchObject({ updated: false });
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-open",
          visibility: "org",
        }),
      ).resolves.toMatchObject({ ok: true, visibility: "org" });
    });
    expect(seen.map((s) => s.change)).toEqual([
      { kind: "grant" },
      { kind: "grant" },
      { kind: "visibility", visibility: "org" },
      { kind: "visibility", visibility: "org" },
    ]);
    const shares = await pglite
      .prepare("SELECT role FROM restricted_doc_shares WHERE resource_id = ?")
      .all("doc-open");
    expect(shares).toEqual([{ role: "viewer" }]);
    const rows = (await pglite
      .prepare("SELECT visibility FROM restricted_docs WHERE id = ?")
      .all("doc-open")) as Array<{ visibility: string }>;
    expect(rows[0]?.visibility).toBe("org");
  });

  it("removes a new share that the post-write check refuses, then rethrows", async () => {
    await insertDoc({ id: "doc-raced" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-raced",
          principalType: "user",
          principalId: orgMemberEmail,
          role: "viewer",
          notify: false,
        }),
      ).rejects.toThrow(raceRefusal);
    });

    const shares = await pglite
      .prepare("SELECT * FROM restricted_doc_shares WHERE resource_id = ?")
      .all("doc-raced");
    expect(shares).toEqual([]);
    expect(
      seen.filter((s) => s.id === "doc-raced").map((s) => s.change),
    ).toEqual([{ kind: "grant" }, { kind: "grant" }]);
  });

  it("restores an updated share to its previous role when the post-write check refuses", async () => {
    await insertDoc({ id: "doc-raced-update" });
    await db.insert(docShares).values({
      id: "existing-share",
      resourceId: "doc-raced-update",
      principalType: "user",
      principalId: orgMemberEmail,
      role: "viewer",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-raced-update",
          principalType: "user",
          principalId: orgMemberEmail,
          role: "editor",
          notify: false,
        }),
      ).rejects.toThrow(raceRefusal);
    });

    const shares = await pglite
      .prepare(
        "SELECT id, role FROM restricted_doc_shares WHERE resource_id = ?",
      )
      .all("doc-raced-update");
    expect(shares).toEqual([{ id: "existing-share", role: "viewer" }]);
  });

  it("restores the visibility when the post-write check refuses the change", async () => {
    await insertDoc({ id: "doc-raced-visibility" });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-raced-visibility",
          visibility: "org",
        }),
      ).rejects.toThrow(raceRefusal);
    });

    const rows = (await pglite
      .prepare("SELECT visibility FROM restricted_docs WHERE id = ?")
      .all("doc-raced-visibility")) as Array<{ visibility: string }>;
    expect(rows[0]?.visibility).toBe("private");
  });

  it("detaches the organization that a refused visibility change attached", async () => {
    await db.insert(docs).values({
      id: "doc-raced-unscoped",
      title: "doc-raced-unscoped",
      ownerEmail,
      orgId: null,
      visibility: "private",
    });
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-raced-unscoped",
          visibility: "org",
        }),
      ).rejects.toThrow(raceRefusal);
    });

    const rows = (await pglite
      .prepare("SELECT visibility, org_id FROM restricted_docs WHERE id = ?")
      .all("doc-raced-unscoped")) as Array<{
      visibility: string;
      org_id: string | null;
    }>;
    expect(rows).toEqual([{ visibility: "private", org_id: null }]);
  });
});

export type _RoleType = ShareRole;
