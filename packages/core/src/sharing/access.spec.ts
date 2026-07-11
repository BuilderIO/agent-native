import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { table, text, ownableColumns } from "../db/schema.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  accessFilter,
  assertAccess,
  ForbiddenError,
  resolveAccess,
} from "./access.js";
import listResourceShares from "./actions/list-resource-shares.js";
import setResourceVisibility from "./actions/set-resource-visibility.js";
import shareResource from "./actions/share-resource.js";
import {
  isSyntheticQaEmail,
  resolveShareNotificationUrl,
} from "./actions/share-resource.js";
import unshareResource from "./actions/unshare-resource.js";
import { registerShareableResource } from "./registry.js";
import { createSharesTable, type ShareRole } from "./schema.js";

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
    orgId: values.orgId === undefined ? orgId : values.orgId,
    visibility: values.visibility ?? "private",
  });
}

async function listVisible(
  ctx: { userEmail?: string; orgId?: string },
  minRole: ShareRole = "viewer",
  options: { includePublic?: boolean } = {},
) {
  return runWithRequestContext(ctx, async () => {
    const rows = await db
      .select()
      .from(docs)
      .where(accessFilter(docs, docShares, undefined, minRole, options));
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
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
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
  it("recognizes reserved synthetic QA emails so share notifications can be suppressed", () => {
    expect(isSyntheticQaEmail("steve+qa-tools-123@example.test")).toBe(true);
    expect(isSyntheticQaEmail("codex+qa-lane@example.invalid")).toBe(true);
    expect(isSyntheticQaEmail("steve+qa-tools-123@example.com")).toBe(false);
    expect(isSyntheticQaEmail("steve@example.test")).toBe(false);
  });

  it("builds safe share notification URLs", () => {
    expect(
      resolveShareNotificationUrl(
        "/deck/doc-actions",
        undefined,
        "https://slides.example.com",
      ),
    ).toBe("https://slides.example.com/deck/doc-actions");
    expect(
      resolveShareNotificationUrl(
        "https://slides.example.com/deck/doc-actions",
        undefined,
        "https://slides.example.com",
      ),
    ).toBe("https://slides.example.com/deck/doc-actions");
    expect(
      resolveShareNotificationUrl(
        "https://evil.example/deck/doc-actions",
        "/deck/fallback",
        "https://slides.example.com",
      ),
    ).toBe("https://slides.example.com/deck/fallback");
    expect(
      resolveShareNotificationUrl(
        "mailto:viewer@example.com",
        undefined,
        "https://slides.example.com",
      ),
    ).toBe("https://slides.example.com");
  });

  it("resolves organization share display names", async () => {
    await insertDoc({ id: "doc-org-share" });
    sqlite
      .prepare(
        `INSERT INTO organizations (id, name, created_by, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(otherOrgId, "Builder.io", ownerEmail, Date.now());
    await db.insert(docShares).values({
      id: "share-org",
      resourceId: "doc-org-share",
      principalType: "org",
      principalId: otherOrgId,
      role: "editor",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    });

    const result = await runWithRequestContext(
      { userEmail: ownerEmail, orgId },
      () =>
        listResourceShares.run({
          resourceType,
          resourceId: "doc-org-share",
        }),
    );

    expect(result.shares).toEqual([
      expect.objectContaining({
        principalType: "org",
        principalId: otherOrgId,
        displayName: "Builder.io",
      }),
    ]);
  });

  it("filters list access across owner, private, org, public, user share, org share, and anonymous contexts", async () => {
    await insertDoc({ id: "owned" });
    await insertDoc({ id: "owned-other-org", orgId: otherOrgId });
    await insertDoc({ id: "owned-solo", orgId: null });
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

    // Public visibility is intentionally omitted from list queries by default
    // — public means "anyone with the link," not "appears in everyone's list."
    await expect(
      listVisible({ userEmail: ownerEmail, orgId }),
    ).resolves.toEqual(["owned", "owned-solo", "same-org", "shared-org"]);
    await expect(
      listVisible({ userEmail: ownerEmail, orgId: otherOrgId }),
    ).resolves.toEqual(["other-org", "owned-other-org", "owned-solo"]);
    await expect(listVisible({ userEmail: ownerEmail })).resolves.toEqual([
      "owned-solo",
    ]);
    await expect(
      listVisible({ userEmail: viewerEmail, orgId }),
    ).resolves.toEqual(["same-org", "shared-org", "shared-user"]);
    await expect(listVisible({ userEmail: viewerEmail })).resolves.toEqual([
      "shared-user",
    ]);
    await expect(listVisible({})).resolves.toEqual([]);
    await expect(
      listVisible({ userEmail: viewerEmail, orgId }, "editor"),
    ).resolves.toEqual(["shared-org"]);

    // Opt-in: callers that want cross-user public discovery in a list
    // (e.g. a public template gallery) pass `{ includePublic: true }`.
    await expect(
      listVisible({ userEmail: viewerEmail }, "viewer", {
        includePublic: true,
      }),
    ).resolves.toEqual(["public-other", "shared-user"]);
  });

  it("resolves read and write roles without letting visibility imply edit access", async () => {
    await insertDoc({ id: "doc-private" });
    await insertDoc({ id: "doc-owned-other-org", orgId: otherOrgId });
    await insertDoc({ id: "doc-owned-solo", orgId: null });
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
      await expect(
        resolveAccess(resourceType, "doc-owned-other-org"),
      ).resolves.toBe(null);
      await expect(
        assertAccess(resourceType, "doc-owned-solo", "owner"),
      ).resolves.toMatchObject({ role: "owner" });
    });

    await runWithRequestContext(
      { userEmail: ownerEmail, orgId: otherOrgId },
      async () => {
        await expect(
          assertAccess(resourceType, "doc-owned-other-org", "owner"),
        ).resolves.toMatchObject({ role: "owner" });
        await expect(resolveAccess(resourceType, "doc-private")).resolves.toBe(
          null,
        );
      },
    );

    await runWithRequestContext({ userEmail: ownerEmail }, async () => {
      await expect(
        assertAccess(resourceType, "doc-owned-solo", "owner"),
      ).resolves.toMatchObject({ role: "owner" });
      await expect(resolveAccess(resourceType, "doc-private")).resolves.toBe(
        null,
      );
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

  it("allows a resource registration to explicitly upgrade public-by-link access", async () => {
    const publicEditType = "qa-doc-public-editor";
    registerShareableResource({
      type: publicEditType,
      resourceTable: docs,
      sharesTable: docShares,
      displayName: "QA Public Editable Doc",
      titleColumn: "title",
      getDb: () => db,
      publicAccessRole: (resource) =>
        resource.id === "doc-public-edit" ? "editor" : "viewer",
    });

    await insertDoc({
      id: "doc-public-view",
      ownerEmail: outsiderEmail,
      visibility: "public",
    });
    await insertDoc({
      id: "doc-public-edit",
      ownerEmail: outsiderEmail,
      visibility: "public",
    });

    await runWithRequestContext({}, async () => {
      await expect(
        resolveAccess(publicEditType, "doc-public-view"),
      ).resolves.toMatchObject({ role: "viewer" });
      await expect(
        assertAccess(publicEditType, "doc-public-view", "editor"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        assertAccess(publicEditType, "doc-public-edit", "editor"),
      ).resolves.toMatchObject({ role: "editor" });
    });
  });

  it("resolves access when the Drizzle table has additive columns missing from the database", async () => {
    const driftDocs = table("qa_drift_docs", {
      id: text("id").primaryKey(),
      title: text("title").notNull(),
      data: text("data").notNull(),
      futureColumn: text("future_column"),
      ...ownableColumns(),
    });
    const driftShares = createSharesTable("qa_drift_doc_shares");
    const driftType = "qa-doc-schema-drift";

    sqlite.exec(`
      CREATE TABLE qa_drift_docs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        data TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE qa_drift_doc_shares (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    registerShareableResource({
      type: driftType,
      resourceTable: driftDocs,
      sharesTable: driftShares,
      displayName: "Schema Drift Doc",
      titleColumn: "title",
      getDb: () => db,
      publicAccessRole: (resource) =>
        resource.data === '{"publicEdit":true}' ? "editor" : "viewer",
    });

    sqlite
      .prepare(
        `INSERT INTO qa_drift_docs (id, title, data, owner_email, org_id, visibility)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "drift-public",
        "Drift Public",
        '{"publicEdit":true}',
        outsiderEmail,
        orgId,
        "public",
      );

    await runWithRequestContext({}, async () => {
      await expect(
        resolveAccess(driftType, "drift-public"),
      ).resolves.toMatchObject({
        role: "editor",
        resource: {
          id: "drift-public",
          title: "Drift Public",
          data: '{"publicEdit":true}',
          ownerEmail: outsiderEmail,
          visibility: "public",
        },
      });
    });
  });

  it("rejects visibility changes from org and public viewer access", async () => {
    await insertDoc({
      id: "doc-org-viewer-policy",
      ownerEmail: outsiderEmail,
      visibility: "org",
    });
    await insertDoc({
      id: "doc-public-viewer-policy",
      ownerEmail: outsiderEmail,
      visibility: "public",
    });

    await runWithRequestContext({ userEmail: viewerEmail, orgId }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-org-viewer-policy",
          visibility: "private",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-public-viewer-policy",
          visibility: "org",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    const rows = await db
      .select()
      .from(docs)
      .where(eq(docs.ownerEmail, outsiderEmail));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "doc-org-viewer-policy",
          visibility: "org",
        }),
        expect.objectContaining({
          id: "doc-public-viewer-policy",
          visibility: "public",
        }),
      ]),
    );
  });

  it("matches owner and user-share emails case-insensitively", async () => {
    await insertDoc({
      id: "doc-owned-case",
      ownerEmail: "Owner+QA@Example.COM",
    });
    await insertDoc({ id: "doc-shared-case", ownerEmail: outsiderEmail });
    await db.insert(docShares).values({
      id: "share-case",
      resourceId: "doc-shared-case",
      principalType: "user",
      principalId: "Viewer+QA@Example.COM",
      role: "editor",
      createdBy: ownerEmail,
      createdAt: "2026-04-30T00:00:00.000Z",
    });

    await expect(
      listVisible({ userEmail: "owner+qa@example.com", orgId }),
    ).resolves.toContain("doc-owned-case");

    await runWithRequestContext(
      { userEmail: "OWNER+QA@example.com", orgId },
      async () => {
        await expect(
          assertAccess(resourceType, "doc-owned-case", "owner"),
        ).resolves.toMatchObject({ role: "owner" });
      },
    );

    await runWithRequestContext(
      { userEmail: "viewer+qa@example.com", orgId },
      async () => {
        await expect(
          assertAccess(resourceType, "doc-shared-case", "editor"),
        ).resolves.toMatchObject({ role: "editor" });
      },
    );
  });

  it("can opt a resource into owner access regardless of active org", async () => {
    registerShareableResource({
      type: resourceType,
      resourceTable: docs,
      sharesTable: docShares,
      displayName: "QA Doc",
      titleColumn: "title",
      getDb: () => db,
      ownerAccessIgnoresOrg: true,
    });
    await insertDoc({ id: "doc-cross-org-owner", orgId: otherOrgId });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        assertAccess(resourceType, "doc-cross-org-owner", "owner"),
      ).resolves.toMatchObject({ role: "owner" });
      await expect(
        listVisible({ userEmail: ownerEmail, orgId }),
      ).resolves.toContain("doc-cross-org-owner");
    });
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
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-actions",
          visibility: "private",
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
    const [doc] = await db
      .select()
      .from(docs)
      .where(eq(docs.id, "doc-actions"));
    expect(doc).toMatchObject({ visibility: "org" });
  });

  it("upserts and revokes user shares case-insensitively", async () => {
    await insertDoc({ id: "doc-user-case-actions" });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-user-case-actions",
          principalType: "user",
          principalId: "Viewer+QA@Example.COM",
          role: "viewer",
        }),
      ).resolves.toMatchObject({ updated: false });

      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-user-case-actions",
          principalType: "user",
          principalId: viewerEmail,
          role: "admin",
        }),
      ).resolves.toMatchObject({ updated: true });
    });

    let shares = await db
      .select()
      .from(docShares)
      .where(eq(docShares.resourceId, "doc-user-case-actions"));
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({
      principalType: "user",
      principalId: viewerEmail,
      role: "admin",
    });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        unshareResource.run({
          resourceType,
          resourceId: "doc-user-case-actions",
          principalType: "user",
          principalId: "VIEWER+QA@EXAMPLE.COM",
        }),
      ).resolves.toEqual({ ok: true });
    });

    shares = await db
      .select()
      .from(docShares)
      .where(eq(docShares.resourceId, "doc-user-case-actions"));
    expect(shares).toHaveLength(0);
  });

  it("rejects non-email user share principals", async () => {
    await insertDoc({ id: "doc-user-principal-validation" });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        shareResource.run({
          resourceType,
          resourceId: "doc-user-principal-validation",
          principalType: "user",
          principalId: "opaque-user-id",
          role: "viewer",
        }),
      ).rejects.toThrow(/email address/);
    });

    const shares = await db
      .select()
      .from(docShares)
      .where(eq(docShares.resourceId, "doc-user-principal-validation"));
    expect(shares).toHaveLength(0);
  });

  it("attaches legacy unscoped owner resources to the active org when making them org-visible", async () => {
    await insertDoc({ id: "doc-legacy-solo", orgId: null });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        listResourceShares.run({
          resourceType,
          resourceId: "doc-legacy-solo",
        }),
      ).resolves.toMatchObject({
        role: "owner",
        orgId: null,
        visibility: "private",
      });

      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-legacy-solo",
          visibility: "org",
        }),
      ).resolves.toEqual({ ok: true, visibility: "org" });
    });

    const [row] = await db
      .select()
      .from(docs)
      .where(eq(docs.id, "doc-legacy-solo"));
    expect(row).toMatchObject({ orgId, visibility: "org" });
  });

  it("keeps org-normalized owner resources unscoped when making them org-visible", async () => {
    registerShareableResource({
      type: resourceType,
      resourceTable: docs,
      sharesTable: docShares,
      displayName: "QA Doc",
      titleColumn: "title",
      getDb: () => db,
      resolveAccessContext: (ctx) =>
        ctx.userEmail === ownerEmail ? { userEmail: ctx.userEmail } : ctx,
    });
    await insertDoc({ id: "doc-local-solo", orgId: null });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-local-solo",
          visibility: "org",
        }),
      ).resolves.toEqual({ ok: true, visibility: "org" });
    });

    const [row] = await db
      .select()
      .from(docs)
      .where(eq(docs.id, "doc-local-solo"));
    expect(row).toMatchObject({ orgId: null, visibility: "org" });
  });

  it("rejects org visibility for unscoped resources when no active org is selected", async () => {
    await insertDoc({ id: "doc-no-active-org", orgId: null });

    await runWithRequestContext({ userEmail: ownerEmail }, async () => {
      await expect(
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-no-active-org",
          visibility: "org",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    const [row] = await db
      .select()
      .from(docs)
      .where(eq(docs.id, "doc-no-active-org"));
    expect(row).toMatchObject({ orgId: null, visibility: "private" });
  });
});

describe("resolveAccess / assertAccess opt-in projected load", () => {
  const projectedKeys = ["id", "ownerEmail", "orgId", "visibility"].sort();

  it("defaults to loading the full resource row (regression)", async () => {
    await insertDoc({ id: "proj-default-full" });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const access = await resolveAccess(resourceType, "proj-default-full");
      expect(access).toMatchObject({
        role: "owner",
        resource: {
          id: "proj-default-full",
          title: "proj-default-full",
          ownerEmail,
          orgId,
          visibility: "private",
        },
      });
      // The full row includes non-access-decision columns like "title".
      expect(Object.keys(access!.resource)).toEqual(
        expect.arrayContaining(["title"]),
      );
    });
  });

  it("returns only the access-decision columns and identical decisions across owner/org/shared/public cases when opted in", async () => {
    await insertDoc({ id: "proj-owner" });
    await insertDoc({
      id: "proj-org",
      ownerEmail: outsiderEmail,
      visibility: "org",
    });
    await insertDoc({ id: "proj-shared-user", ownerEmail: outsiderEmail });
    await insertDoc({ id: "proj-shared-org", ownerEmail: outsiderEmail });
    await insertDoc({
      id: "proj-public",
      ownerEmail: outsiderEmail,
      visibility: "public",
    });
    await db.insert(docShares).values([
      {
        id: "proj-share-user",
        resourceId: "proj-shared-user",
        principalType: "user",
        principalId: viewerEmail,
        role: "viewer",
        createdBy: ownerEmail,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
      {
        id: "proj-share-org",
        resourceId: "proj-shared-org",
        principalType: "org",
        principalId: orgId,
        role: "editor",
        createdBy: ownerEmail,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    ]);

    const cases: Array<{
      ctx: { userEmail?: string; orgId?: string };
      id: string;
    }> = [
      { ctx: { userEmail: ownerEmail, orgId }, id: "proj-owner" },
      { ctx: { userEmail: viewerEmail, orgId }, id: "proj-org" },
      { ctx: { userEmail: viewerEmail, orgId }, id: "proj-shared-user" },
      { ctx: { userEmail: viewerEmail, orgId }, id: "proj-shared-org" },
      { ctx: { userEmail: viewerEmail, orgId }, id: "proj-public" },
    ];

    for (const { ctx, id } of cases) {
      await runWithRequestContext(ctx, async () => {
        const full = await resolveAccess(resourceType, id);
        const projected = await resolveAccess(resourceType, id, undefined, {
          skipResourceBody: true,
        });

        expect(full).not.toBeNull();
        expect(projected).not.toBeNull();
        expect(projected!.role).toBe(full!.role);
        expect(Object.keys(projected!.resource).sort()).toEqual(projectedKeys);
        expect(projected!.resource).toEqual({
          id: full!.resource.id,
          ownerEmail: full!.resource.ownerEmail,
          orgId: full!.resource.orgId,
          visibility: full!.resource.visibility,
        });
      });
    }
  });

  it("assertAccess also supports the opt-in projected load and still enforces role checks", async () => {
    await insertDoc({ id: "proj-assert" });

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const access = await assertAccess(
        resourceType,
        "proj-assert",
        "owner",
        undefined,
        { skipResourceBody: true },
      );
      expect(access.role).toBe("owner");
      expect(Object.keys(access.resource).sort()).toEqual(projectedKeys);
    });

    await runWithRequestContext({ userEmail: viewerEmail, orgId }, async () => {
      await expect(
        assertAccess(resourceType, "proj-assert", "owner", undefined, {
          skipResourceBody: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("ignores the projection and loads the full row for a registration with a dynamic publicAccessRole resolver", async () => {
    const dynamicResolverType = "qa-doc-dynamic-resolver";
    registerShareableResource({
      type: dynamicResolverType,
      resourceTable: docs,
      sharesTable: docShares,
      displayName: "QA Doc Dynamic Resolver",
      titleColumn: "title",
      getDb: () => db,
      publicAccessRole: (resource) =>
        resource.title === "proj-dynamic-edit" ? "editor" : "viewer",
    });

    await insertDoc({
      id: "proj-dynamic-edit",
      ownerEmail: outsiderEmail,
      visibility: "public",
    });

    await runWithRequestContext({}, async () => {
      const access = await resolveAccess(
        dynamicResolverType,
        "proj-dynamic-edit",
        undefined,
        { skipResourceBody: true },
      );
      // The resolver reads `resource.title`, which only exists on a full
      // row — this proves the opt-in projection was ignored for a
      // registration with a dynamic `publicAccessRole` resolver.
      expect(access).toMatchObject({
        role: "editor",
        resource: { title: "proj-dynamic-edit" },
      });
      expect(Object.keys(access!.resource)).toEqual(
        expect.arrayContaining(["title"]),
      );
    });
  });
});
