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
