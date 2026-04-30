import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { table, text, ownableColumns } from "../db/schema.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  accessFilter,
  assertAccess,
  ForbiddenError,
  resolveAccess,
} from "./access.js";
import { createSharesTable, type ShareRole } from "./schema.js";
import { registerShareableResource } from "./registry.js";
import shareResource from "./actions/share-resource.js";
import unshareResource from "./actions/unshare-resource.js";
import listResourceShares from "./actions/list-resource-shares.js";
import setResourceVisibility from "./actions/set-resource-visibility.js";

const resourceType = "qa-doc";
const ownerEmail = "owner+qa@example.com";
const viewerEmail = "viewer+qa@example.com";
const outsiderEmail = "outsider+qa@example.com";
const orgId = "org-qa";
const otherOrgId = "org-other";

const docs = table("qa_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(),
});

const docShares = createSharesTable("qa_doc_shares");

type Db = ReturnType<typeof drizzle>;

let sqlite: Database.Database;
let db: Db;

async function insertDoc(values: {
  id: string;
  ownerEmail?: string;
  orgId?: string | null;
  visibility?: "private" | "org" | "public";
}) {
  await db.insert(docs).values({
    id: values.id,
    title: values.id,
    ownerEmail: values.ownerEmail ?? ownerEmail,
    orgId: values.orgId ?? orgId,
    visibility: values.visibility ?? "private",
  });
}

async function listVisible(
  ctx: { userEmail?: string; orgId?: string },
  minRole: ShareRole = "viewer",
) {
  return runWithRequestContext(ctx, async () => {
    const rows = await db
      .select()
      .from(docs)
      .where(accessFilter(docs, docShares, undefined, minRole));
    return rows.map((row) => row.id).sort();
  });
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE qa_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE qa_doc_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db = drizzle(sqlite);
  registerShareableResource({
    type: resourceType,
    resourceTable: docs,
    sharesTable: docShares,
    displayName: "QA Doc",
    titleColumn: "title",
    getDb: () => db,
  });
});

afterEach(() => {
  sqlite.close();
});

describe("shareable resource access helpers", () => {
  it("filters list access across owner, private, org, public, user share, org share, and anonymous contexts", async () => {
    await insertDoc({ id: "owned" });
    await insertDoc({ id: "private-other", ownerEmail: outsiderEmail });
    await insertDoc({
      id: "same-org",
      ownerEmail: outsiderEmail,
      visibility: "org",
    });
    await insertDoc({
      id: "other-org",
      ownerEmail: outsiderEmail,
      orgId: otherOrgId,
      visibility: "org",
    });
    await insertDoc({
      id: "public-other",
      ownerEmail: outsiderEmail,
      visibility: "public",
    });
    await insertDoc({ id: "shared-user", ownerEmail: outsiderEmail });
    await insertDoc({ id: "shared-org", ownerEmail: outsiderEmail });

    await db.insert(docShares).values([
      {
        id: "share-user",
        resourceId: "shared-user",
        principalType: "user",
        principalId: viewerEmail,
        role: "viewer",
        createdBy: ownerEmail,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
      {
        id: "share-org",
        resourceId: "shared-org",
        principalType: "org",
        principalId: orgId,
        role: "editor",
        createdBy: ownerEmail,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    ]);

    await expect(
      listVisible({ userEmail: ownerEmail, orgId }),
    ).resolves.toEqual(["owned", "public-other", "same-org", "shared-org"]);
    await expect(
      listVisible({ userEmail: viewerEmail, orgId }),
    ).resolves.toEqual([
      "public-other",
      "same-org",
      "shared-org",
      "shared-user",
    ]);
    await expect(listVisible({ userEmail: viewerEmail })).resolves.toEqual([
      "public-other",
      "shared-user",
    ]);
    await expect(listVisible({})).resolves.toEqual(["public-other"]);
    await expect(
      listVisible({ userEmail: viewerEmail, orgId }, "editor"),
    ).resolves.toEqual(["shared-org"]);
  });

  it("resolves read and write roles without letting visibility imply edit access", async () => {
    await insertDoc({ id: "doc-private" });
    await insertDoc({
      id: "doc-org",
      ownerEmail: outsiderEmail,
      visibility: "org",
    });
    await insertDoc({
      id: "doc-public",
      ownerEmail: outsiderEmail,
      visibility: "public",
    });
    await insertDoc({ id: "doc-shared", ownerEmail: outsiderEmail });
    await db.insert(docShares).values({
      id: "share-editor",
      resourceId: "doc-shared",
      principalType: "user",
      principalId: viewerEmail,
      role: "editor",
      createdBy: ownerEmail,
      createdAt: "2026-04-30T00:00:00.000Z",
    });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        assertAccess(resourceType, "doc-private", "owner"),
      ).resolves.toMatchObject({ role: "owner" });
    });

    await runWithRequestContext({ userEmail: viewerEmail, orgId }, async () => {
      await expect(
        resolveAccess(resourceType, "doc-org"),
      ).resolves.toMatchObject({
        role: "viewer",
      });
      await expect(
        resolveAccess(resourceType, "doc-public"),
      ).resolves.toMatchObject({
        role: "viewer",
      });
      await expect(
        assertAccess(resourceType, "doc-org", "editor"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        assertAccess(resourceType, "doc-public", "editor"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        assertAccess(resourceType, "doc-shared", "editor"),
      ).resolves.toMatchObject({ role: "editor" });
      await expect(
        assertAccess(resourceType, "doc-shared", "admin"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    await runWithRequestContext(
      { userEmail: outsiderEmail, orgId: otherOrgId },
      async () => {
        await expect(resolveAccess(resourceType, "doc-private")).resolves.toBe(
          null,
        );
      },
    );
  });

  it("runs share, list, visibility, and unshare actions with role checks", async () => {
    await insertDoc({ id: "doc-actions" });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-actions",
          principalType: "user",
          principalId: viewerEmail,
          role: "viewer",
        }),
      ).resolves.toMatchObject({ updated: false });
    });

    await runWithRequestContext({ userEmail: viewerEmail, orgId }, async () => {
      await expect(
        listResourceShares.run({
          resourceType,
          resourceId: "doc-actions",
        }),
      ).resolves.toMatchObject({
        ownerEmail,
        visibility: "private",
        role: "viewer",
        shares: [
          {
            principalType: "user",
            principalId: viewerEmail,
            role: "viewer",
          },
        ],
      });
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-actions",
          visibility: "org",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-actions",
          principalType: "user",
          principalId: viewerEmail,
          role: "admin",
        }),
      ).resolves.toMatchObject({ updated: true });
    });

    await runWithRequestContext({ userEmail: viewerEmail, orgId }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-actions",
          visibility: "org",
        }),
      ).resolves.toEqual({ ok: true, visibility: "org" });
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-actions",
          principalType: "org",
          principalId: otherOrgId,
          role: "viewer",
        }),
      ).resolves.toMatchObject({ updated: false });
      await expect(
        unshareResource.run({
          resourceType,
          resourceId: "doc-actions",
          principalType: "org",
          principalId: otherOrgId,
        }),
      ).resolves.toEqual({ ok: true });
    });

    const shares = await db
      .select()
      .from(docShares)
      .where(eq(docShares.resourceId, "doc-actions"));
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({
      principalType: "user",
      principalId: viewerEmail,
      role: "admin",
    });
  });
});
