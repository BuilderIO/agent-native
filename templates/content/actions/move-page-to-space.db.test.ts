import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./_local-file-documents.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./_local-file-documents.js")>();
  return { ...original, isContentLocalFileMode: async () => false };
});
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: vi.fn().mockResolvedValue(undefined),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `move-page-to-space-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createDocument: typeof import("./create-document.js").default;
let createContentDatabase: typeof import("./create-content-database.js").default;
let moveDocument: typeof import("./move-document.js").default;
let duplicatePage: typeof import("./duplicate-page.js").default;
let listComments: typeof import("./list-comments.js").default;
let organizationContentSpaceId: typeof import("./_content-spaces.js").organizationContentSpaceId;
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const ORG_ID = "org-move-between-spaces";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createDocument = (await import("./create-document.js")).default;
  createContentDatabase = (await import("./create-content-database.js"))
    .default;
  moveDocument = (await import("./move-document.js")).default;
  duplicatePage = (await import("./duplicate-page.js")).default;
  listComments = (await import("./list-comments.js")).default;
  ({ organizationContentSpaceId, personalContentSpaceId } =
    await import("./_content-spaces.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
    args: [ORG_ID, "Team", OWNER, Date.now()],
  });
  for (const [email, role] of [
    [OWNER, "owner"],
    [EDITOR, "member"],
  ]) {
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: [`${ORG_ID}:${email}`, ORG_ID, email, role, Date.now()],
    });
  }
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

const as = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail, orgId: ORG_ID }, run);

async function documentRows(ids: string[]) {
  return getDb()
    .select({
      id: schema.documents.id,
      spaceId: schema.documents.spaceId,
      ownerEmail: schema.documents.ownerEmail,
      orgId: schema.documents.orgId,
      visibility: schema.documents.visibility,
      parentId: schema.documents.parentId,
    })
    .from(schema.documents)
    .where(inArray(schema.documents.id, ids));
}

async function filesSpaces(documentId: string) {
  const rows = await getDb()
    .select({ spaceId: schema.contentDatabases.spaceId })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        eq(schema.contentDatabases.systemRole, "files"),
      ),
    );
  return rows.map((row: { spaceId: string }) => row.spaceId);
}

async function share(resourceId: string, principalId: string, role: string) {
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `share-${resourceId}-${principalId}`,
      resourceId,
      principalType: "user",
      principalId,
      role,
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
}

describe("moving a page between Content spaces", () => {
  it("moves the page and its sub-pages with their comments and history, and resets access to the destination", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const page = await as(OWNER, () =>
      createDocument.run({ title: "Plan", content: "# Plan" }),
    );
    const child = await as(OWNER, () =>
      createDocument.run({ title: "Details", parentId: page.id }),
    );
    await share(page.id, EDITOR, "viewer");
    await getDb().insert(schema.documentComments).values({
      id: "comment-plan",
      ownerEmail: OWNER,
      documentId: child.id,
      threadId: "thread-plan",
      content: "Looks good",
      authorEmail: OWNER,
    });
    await getDb().insert(schema.documentVersions).values({
      id: "version-plan",
      ownerEmail: OWNER,
      documentId: page.id,
      title: "Plan",
      content: "# Draft",
    });

    const moved = await as(OWNER, () =>
      moveDocument.run({ id: page.id, spaceId: orgSpaceId }),
    );

    expect(moved).toMatchObject({ spaceId: orgSpaceId, parentId: null });
    expect(await documentRows([page.id, child.id])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: page.id,
          spaceId: orgSpaceId,
          orgId: ORG_ID,
          visibility: "org",
          ownerEmail: OWNER,
          parentId: null,
        }),
        expect.objectContaining({
          id: child.id,
          spaceId: orgSpaceId,
          orgId: ORG_ID,
          visibility: "org",
          parentId: page.id,
        }),
      ]),
    );
    expect(await filesSpaces(page.id)).toEqual([orgSpaceId]);
    expect(await filesSpaces(child.id)).toEqual([orgSpaceId]);
    const shares = await getDb()
      .select()
      .from(schema.documentShares)
      .where(eq(schema.documentShares.resourceId, page.id));
    expect(shares).toEqual([]);
    const comments = await as(EDITOR, () =>
      listComments.run({ documentId: child.id }),
    );
    expect(JSON.stringify(comments)).toContain("Looks good");
    const [version] = await getDb()
      .select({ ownerEmail: schema.documentVersions.ownerEmail })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, "version-plan"));
    expect(version.ownerEmail).toBe(OWNER);
  });

  it("makes the person moving the owner and closes the page to everyone else in Personal", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const page = await as(OWNER, () =>
      createDocument.run({ title: "Handoff", spaceId: orgSpaceId }),
    );
    const child = await as(OWNER, () =>
      createDocument.run({ title: "Notes", parentId: page.id }),
    );

    await expect(
      as(EDITOR, () =>
        moveDocument.run({
          id: page.id,
          spaceId: personalContentSpaceId(EDITOR),
        }),
      ),
    ).rejects.toThrow(/editor/i);

    await share(page.id, EDITOR, "editor");
    await share(child.id, EDITOR, "editor");
    await getDb().insert(schema.documentComments).values({
      id: "comment-handoff",
      ownerEmail: OWNER,
      documentId: page.id,
      threadId: "thread-handoff",
      content: "Over to you",
      authorEmail: OWNER,
    });
    await as(EDITOR, () =>
      moveDocument.run({
        id: page.id,
        spaceId: personalContentSpaceId(EDITOR),
      }),
    );

    expect(await documentRows([page.id, child.id])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: page.id,
          ownerEmail: EDITOR,
          orgId: null,
          visibility: "private",
          spaceId: personalContentSpaceId(EDITOR),
        }),
        expect.objectContaining({
          id: child.id,
          ownerEmail: EDITOR,
          visibility: "private",
        }),
      ]),
    );
    const comments = await as(EDITOR, () =>
      listComments.run({ documentId: page.id }),
    );
    expect(JSON.stringify(comments)).toContain("Over to you");
    await expect(
      as(OWNER, () => listComments.run({ documentId: page.id })),
    ).rejects.toThrow();
  });

  it("only nests under a page the mover owns in the destination", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const othersPage = await as(EDITOR, () =>
      createDocument.run({ title: "Editor's page", spaceId: orgSpaceId }),
    );
    const ownPage = await as(OWNER, () =>
      createDocument.run({ title: "Owner's page", spaceId: orgSpaceId }),
    );
    const page = await as(OWNER, () =>
      createDocument.run({ title: "Nest me" }),
    );
    await share(othersPage.id, OWNER, "editor");

    await expect(
      as(OWNER, () =>
        moveDocument.run({
          id: page.id,
          spaceId: orgSpaceId,
          parentId: othersPage.id,
        }),
      ),
    ).rejects.toThrow("page you own");
    await as(OWNER, () =>
      moveDocument.run({
        id: page.id,
        spaceId: orgSpaceId,
        parentId: ownPage.id,
      }),
    );
    expect(await documentRows([page.id])).toEqual([
      expect.objectContaining({ parentId: ownPage.id, spaceId: orgSpaceId }),
    ]);
  });

  it("refuses pages that contain a collection", async () => {
    const page = await as(OWNER, () =>
      createDocument.run({ title: "Tracker" }),
    );
    await as(OWNER, () =>
      createContentDatabase.run({ title: "Tasks", parentId: page.id } as any),
    );
    await expect(
      as(OWNER, () =>
        moveDocument.run({
          id: page.id,
          spaceId: organizationContentSpaceId(ORG_ID),
        }),
      ),
    ).rejects.toThrow("contain collections");
    expect(await documentRows([page.id])).toEqual([
      expect.objectContaining({ spaceId: personalContentSpaceId(OWNER) }),
    ]);
  });
});

describe("duplicating a page", () => {
  it("copies sub-pages beside the original in the same space", async () => {
    const parent = await as(OWNER, () =>
      createDocument.run({ title: "Parent" }),
    );
    const page = await as(OWNER, () =>
      createDocument.run({ title: "Guide", parentId: parent.id }),
    );
    const child = await as(OWNER, () =>
      createDocument.run({
        title: "Chapter",
        content: "Body",
        parentId: page.id,
      }),
    );

    const copy = await as(OWNER, () =>
      duplicatePage.run({ documentId: page.id }),
    );

    expect(copy).toMatchObject({
      title: "Copy of Guide",
      parentId: parent.id,
      copiedCount: 2,
    });
    const children = await getDb()
      .select({
        title: schema.documents.title,
        content: schema.documents.content,
      })
      .from(schema.documents)
      .where(eq(schema.documents.parentId, copy.id));
    expect(children).toEqual([{ title: "Chapter", content: "Body" }]);
    const siblings = await getDb()
      .select({ id: schema.documents.id, position: schema.documents.position })
      .from(schema.documents)
      .where(eq(schema.documents.parentId, parent.id));
    const order = siblings
      .sort(
        (a: { position: number }, b: { position: number }) =>
          a.position - b.position,
      )
      .map((row: { id: string }) => row.id);
    expect(order.indexOf(copy.id)).toBe(order.indexOf(page.id) + 1);
    expect(await documentRows([child.id])).toEqual([
      expect.objectContaining({ parentId: page.id }),
    ]);
  });

  it("copies a page and its sub-pages into another space and leaves the original", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const page = await as(OWNER, () => createDocument.run({ title: "Recipe" }));
    await as(OWNER, () =>
      createDocument.run({ title: "Step one", parentId: page.id }),
    );

    const copy = await as(OWNER, () =>
      duplicatePage.run({ documentId: page.id, spaceId: orgSpaceId }),
    );

    expect(copy).toMatchObject({
      spaceId: orgSpaceId,
      parentId: null,
      copiedCount: 2,
    });
    const [copiedChild] = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.parentId, copy.id));
    expect(await documentRows([copy.id, copiedChild.id])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ visibility: "org", orgId: ORG_ID }),
      ]),
    );
    expect(await filesSpaces(copiedChild.id)).toEqual([orgSpaceId]);
    expect(await documentRows([page.id])).toEqual([
      expect.objectContaining({ spaceId: personalContentSpaceId(OWNER) }),
    ]);
  });

  it("refuses a parent outside the destination space", async () => {
    const page = await as(OWNER, () => createDocument.run({ title: "Memo" }));
    const orgParent = await as(OWNER, () =>
      createDocument.run({
        title: "Team folder",
        spaceId: organizationContentSpaceId(ORG_ID),
      }),
    );
    await expect(
      as(OWNER, () =>
        duplicatePage.run({ documentId: page.id, parentId: orgParent.id }),
      ),
    ).rejects.toThrow("destination Content space");
  });
});
