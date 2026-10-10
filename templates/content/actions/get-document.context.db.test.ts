import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-get-document-context-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "context-owner@example.com";
const OTHER = "context-other@example.com";
const ORGANIZATION_ID = "context-organization";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let getDocumentAction: typeof import("./get-document.js").default;
let getPreviewDraftAction: typeof import("./get-preview-document-draft.js").default;
let getDocumentContextPath: typeof import("../server/lib/document-context.js").getDocumentContextPath;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDocumentAction = (await import("./get-document.js")).default;
  getPreviewDraftAction = (await import("./get-preview-document-draft.js"))
    .default;
  getDocumentContextPath = (await import("../server/lib/document-context.js"))
    .getDocumentContextPath;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
    args: [ORGANIZATION_ID, "Context Org", OTHER, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
    args: ["context-member", ORGANIZATION_ID, OWNER, "member", Date.now()],
  });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let createdAt = Date.parse("2026-01-01T00:00:00.000Z");

async function addDocument(args: {
  id: string;
  parentId?: string | null;
  ownerEmail?: string;
  title?: string;
  visibility?: "private" | "org" | "public";
  orgId?: string;
}) {
  const timestamp = new Date((createdAt += 1000)).toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      parentId: args.parentId ?? null,
      ownerEmail: args.ownerEmail ?? OWNER,
      orgId: args.orgId ?? null,
      title: args.title ?? args.id,
      description: `${args.id} description`,
      content: `body of ${args.id}`,
      visibility: args.visibility ?? "private",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
}

async function shareWithOwner(documentId: string) {
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `${documentId}-share`,
      resourceId: documentId,
      principalType: "user",
      principalId: OWNER,
      role: "viewer",
      createdBy: OTHER,
      createdAt: new Date().toISOString(),
    });
}

async function addCollection(args: {
  id: string;
  documentId: string;
  ownerEmail?: string;
  parentId?: string | null;
}) {
  await addDocument({
    id: args.documentId,
    ownerEmail: args.ownerEmail,
    parentId: args.parentId,
    title: `${args.id} page`,
  });
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: args.id,
      ownerEmail: args.ownerEmail ?? OWNER,
      documentId: args.documentId,
      title: `${args.id} title`,
      createdAt: now,
      updatedAt: now,
    });
}

async function addItem(args: {
  id: string;
  databaseId: string;
  documentId: string;
  position: number;
  createdAt: string;
}) {
  await getDb().insert(schema.contentDatabaseItems).values({
    id: args.id,
    ownerEmail: OWNER,
    databaseId: args.databaseId,
    documentId: args.documentId,
    position: args.position,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  });
}

async function addProperty(args: {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  position: number;
}) {
  const now = new Date().toISOString();
  await getDb().insert(schema.documentPropertyDefinitions).values({
    id: args.id,
    ownerEmail: OWNER,
    databaseId: args.databaseId,
    name: args.name,
    type: args.type,
    visibility: "always_show",
    optionsJson: "{}",
    position: args.position,
    createdAt: now,
    updatedAt: now,
  });
}

function readAs<T>(email: string, fn: () => Promise<T>) {
  return runWithRequestContext({ userEmail: email }, fn);
}

function getDocument(id: string, databaseId?: string) {
  return readAs(OWNER, () =>
    getDocumentAction.run({ id, databaseId }, { userEmail: OWNER } as any),
  );
}

describe("get-document context and properties", () => {
  it("returns an empty context path for a standalone Page", async () => {
    await addDocument({ id: "standalone-page" });

    expect((await getDocument("standalone-page")).contextPath).toEqual([]);
  });

  it("returns the readable ancestor path, with collection ancestors named by their collection", async () => {
    await addCollection({ id: "context-tracker", documentId: "tracker-page" });
    await addDocument({ id: "tracker-child", parentId: "tracker-page" });
    await addDocument({ id: "tracker-leaf", parentId: "tracker-child" });

    const document = await getDocument("tracker-leaf");

    expect(document.content).toBe("body of tracker-leaf");
    expect(document.contextPath).toEqual([
      {
        id: "context-tracker",
        kind: "database",
        title: "context-tracker title",
        description: "tracker-page description",
      },
      {
        id: "tracker-child",
        kind: "page",
        title: "tracker-child",
        description: "tracker-child description",
      },
    ]);
  });

  it("stops the path at the first ancestor the reader cannot open", async () => {
    await addDocument({ id: "blocked-root" });
    await addDocument({
      id: "blocked-middle",
      parentId: "blocked-root",
      ownerEmail: OTHER,
    });
    await addDocument({ id: "blocked-leaf", parentId: "blocked-middle" });

    expect((await getDocument("blocked-leaf")).contextPath).toEqual([]);

    await shareWithOwner("blocked-middle");
    expect(
      (await getDocument("blocked-leaf")).contextPath.map((entry) => entry.id),
    ).toEqual(["blocked-root", "blocked-middle"]);
  });

  it("admits public and organization-visible ancestors the way resolveAccess does", async () => {
    await addDocument({
      id: "org-grandparent",
      ownerEmail: OTHER,
      orgId: ORGANIZATION_ID,
      visibility: "org",
    });
    await addDocument({
      id: "public-parent",
      parentId: "org-grandparent",
      ownerEmail: OTHER,
      visibility: "public",
    });
    await addDocument({ id: "visibility-leaf", parentId: "public-parent" });
    await addDocument({
      id: "foreign-org-grandparent",
      ownerEmail: OTHER,
      orgId: "context-foreign-organization",
      visibility: "org",
    });
    await addDocument({
      id: "public-parent-of-foreign",
      parentId: "foreign-org-grandparent",
      ownerEmail: OTHER,
      visibility: "public",
    });
    await addDocument({
      id: "foreign-leaf",
      parentId: "public-parent-of-foreign",
    });

    expect(
      (await getDocument("visibility-leaf")).contextPath.map(
        (entry) => entry.id,
      ),
    ).toEqual(["org-grandparent", "public-parent"]);
    expect(
      (await getDocument("foreign-leaf")).contextPath.map((entry) => entry.id),
    ).toEqual(["public-parent-of-foreign"]);
  });

  it("admits an ancestor shared with the active organization only while that organization is active", async () => {
    await addDocument({ id: "org-shared-parent", ownerEmail: OTHER });
    await getDb().insert(schema.documentShares).values({
      id: "org-shared-parent-share",
      resourceId: "org-shared-parent",
      principalType: "org",
      principalId: ORGANIZATION_ID,
      role: "viewer",
      createdBy: OTHER,
      createdAt: new Date().toISOString(),
    });
    await addDocument({ id: "org-shared-leaf", parentId: "org-shared-parent" });
    const leaf = { id: "org-shared-leaf", parentId: "org-shared-parent" };

    const withOrganization = await runWithRequestContext(
      { userEmail: OWNER, orgId: ORGANIZATION_ID },
      () => getDocumentContextPath(leaf),
    );
    expect(withOrganization.map((entry) => entry.id)).toEqual([
      "org-shared-parent",
    ]);
    expect(await readAs(OWNER, () => getDocumentContextPath(leaf))).toEqual([]);
  });

  it("matches owner and share emails regardless of case", async () => {
    await addDocument({
      id: "mixed-case-owned-root",
      ownerEmail: "Context-Owner@Example.COM",
    });
    await addDocument({
      id: "mixed-case-shared-parent",
      parentId: "mixed-case-owned-root",
      ownerEmail: OTHER,
    });
    await getDb().insert(schema.documentShares).values({
      id: "mixed-case-share",
      resourceId: "mixed-case-shared-parent",
      principalType: "user",
      principalId: "CONTEXT-OWNER@example.com",
      role: "viewer",
      createdBy: OTHER,
      createdAt: new Date().toISOString(),
    });
    await addDocument({
      id: "mixed-case-leaf",
      parentId: "mixed-case-shared-parent",
    });

    expect(
      (await getDocument("mixed-case-leaf")).contextPath.map(
        (entry) => entry.id,
      ),
    ).toEqual(["mixed-case-owned-root", "mixed-case-shared-parent"]);
  });

  it("never lists a document in its own path when its parent chain loops back", async () => {
    await addDocument({ id: "self-parent", parentId: "self-parent" });
    await addDocument({ id: "loop-a", parentId: "loop-b" });
    await addDocument({ id: "loop-b", parentId: "loop-a" });

    expect(
      await readAs(OWNER, () =>
        getDocumentContextPath({ id: "self-parent", parentId: "self-parent" }),
      ),
    ).toEqual([]);
    expect(
      (
        await readAs(OWNER, () =>
          getDocumentContextPath({ id: "loop-a", parentId: "loop-b" }),
        )
      ).map((entry) => entry.id),
    ).toEqual(["loop-b"]);
    expect((await getDocument("self-parent")).contextPath).toEqual([]);
  });

  it("gives a shared page no path beyond what its reader can open", async () => {
    await addDocument({ id: "private-owner-root", ownerEmail: OTHER });
    await addDocument({
      id: "shared-leaf",
      parentId: "private-owner-root",
      ownerEmail: OTHER,
    });
    await shareWithOwner("shared-leaf");

    const document = await getDocument("shared-leaf");

    expect(document.accessRole).toBe("viewer");
    expect(document.canEdit).toBe(false);
    expect(document.contextPath).toEqual([]);
    await expect(
      readAs("context-stranger@example.com", () =>
        getDocumentAction.run({ id: "shared-leaf" }, {
          userEmail: "context-stranger@example.com",
        } as any),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("leaves out a collection whose document the reader cannot open", async () => {
    await addCollection({
      id: "private-collection",
      documentId: "private-collection-page",
      ownerEmail: OTHER,
    });
    await addDocument({ id: "shared-row", ownerEmail: OTHER });
    await shareWithOwner("shared-row");
    await addItem({
      id: "shared-row-item",
      databaseId: "private-collection",
      documentId: "shared-row",
      position: 0,
      createdAt: "2026-02-01T00:00:00.000Z",
    });

    const path = await readAs(OWNER, () =>
      getDocumentContextPath({ id: "shared-row", parentId: null }),
    );
    expect(path).toEqual([]);

    await shareWithOwner("private-collection-page");
    expect(
      await readAs(OWNER, () =>
        getDocumentContextPath({ id: "shared-row", parentId: null }),
      ),
    ).toEqual([
      {
        id: "private-collection",
        kind: "database",
        title: "private-collection title",
        description: "private-collection-page description",
      },
    ]);
  });

  it("numbers a row by its canonical position, counting rows the reader cannot open", async () => {
    await addCollection({ id: "numbered", documentId: "numbered-page" });
    await addProperty({
      id: "numbered-id",
      databaseId: "numbered",
      name: "ID",
      type: "id",
      position: 0,
    });
    await addProperty({
      id: "numbered-created",
      databaseId: "numbered",
      name: "Created",
      type: "created_time",
      position: 1,
    });
    await addDocument({ id: "hidden-row", ownerEmail: OTHER });
    await addDocument({ id: "later-row" });
    await addDocument({ id: "earlier-row" });
    await addItem({
      id: "hidden-row-item",
      databaseId: "numbered",
      documentId: "hidden-row",
      position: 0,
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    await addItem({
      id: "later-row-item",
      databaseId: "numbered",
      documentId: "later-row",
      position: 1,
      createdAt: "2026-02-03T00:00:00.000Z",
    });
    await addItem({
      id: "earlier-row-item",
      databaseId: "numbered",
      documentId: "earlier-row",
      position: 1,
      createdAt: "2026-02-02T00:00:00.000Z",
    });

    const valueOf = (
      document: Awaited<ReturnType<typeof getDocument>>,
      name: string,
    ) =>
      document.properties.find((property) => property.definition.name === name)
        ?.value;
    const earlier = await getDocument("earlier-row", "numbered");
    const later = await getDocument("later-row", "numbered");

    expect(valueOf(earlier, "ID")).toBe(2);
    expect(valueOf(later, "ID")).toBe(3);
    expect(valueOf(later, "Created")).toBe(later.createdAt);
    expect(valueOf(await getDocument("later-row"), "ID")).toBe(3);
    expect(later.databaseMembership).toMatchObject({
      databaseId: "numbered",
      databaseDocumentId: "numbered-page",
    });
    expect(later.contextPath).toEqual([
      {
        id: "numbered",
        kind: "database",
        title: "numbered title",
        description: "numbered-page description",
      },
    ]);
  });
});

describe("get-document preview draft", () => {
  async function read(
    id: string,
    includePreviewDraft?: boolean,
    orgId?: string,
  ) {
    return runWithRequestContext({ userEmail: OWNER, orgId }, () =>
      getDocumentAction.run({ id, includePreviewDraft }, {
        userEmail: OWNER,
      } as any),
    );
  }
  function readDraftOnItsOwn(documentId: string, orgId?: string) {
    return runWithRequestContext({ userEmail: OWNER, orgId }, () =>
      getPreviewDraftAction.run({ documentId }),
    );
  }

  it("carries the reader's own draft for the active organization only when asked, as the draft read answers", async () => {
    await addDocument({ id: "drafted-page" });
    await addDocument({ id: "viewed-drafted-page", ownerEmail: OTHER });
    await shareWithOwner("viewed-drafted-page");
    await getDb()
      .insert(schema.documentPreviewDrafts)
      .values([
        {
          id: "own-draft",
          ownerEmail: OWNER,
          documentId: "drafted-page",
          title: "Draft title",
          content: "unsaved body",
        },
        {
          id: "own-organization-draft",
          ownerEmail: OWNER,
          orgId: ORGANIZATION_ID,
          documentId: "drafted-page",
          title: "Organization draft",
          content: "unsaved in the organization",
        },
        {
          id: "other-draft",
          ownerEmail: OTHER,
          documentId: "drafted-page",
          title: "Not mine",
          content: "another reader's body",
        },
        {
          id: "viewer-draft",
          ownerEmail: OWNER,
          documentId: "viewed-drafted-page",
          title: "Old draft",
          content: "written while it was editable",
        },
      ]);

    expect(await read("drafted-page")).not.toHaveProperty("previewDraft");
    const personal = (await read("drafted-page", true)).previewDraft;
    expect(personal).toEqual({
      editable: true,
      draft: expect.objectContaining({
        documentId: "drafted-page",
        content: "unsaved body",
      }),
    });
    expect(personal).toEqual(await readDraftOnItsOwn("drafted-page"));
    const inOrganization = (await read("drafted-page", true, ORGANIZATION_ID))
      .previewDraft;
    expect(inOrganization?.draft?.content).toBe("unsaved in the organization");
    expect(inOrganization).toEqual(
      await readDraftOnItsOwn("drafted-page", ORGANIZATION_ID),
    );
    const viewed = (await read("viewed-drafted-page", true)).previewDraft;
    expect(viewed).toEqual({ editable: false, draft: null });
    expect(viewed).toEqual(await readDraftOnItsOwn("viewed-drafted-page"));
  });

  it("leaves the draft to its own read for a page reached only through its space", async () => {
    const now = new Date().toISOString();
    await getDb().insert(schema.contentSpaces).values({
      id: "context-organization-space",
      name: "Context Org",
      kind: "organization",
      ownerEmail: OTHER,
      orgId: ORGANIZATION_ID,
      filesDatabaseId: "context-organization-files",
      createdBy: OTHER,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.documents).values({
      id: "space-page",
      spaceId: "context-organization-space",
      ownerEmail: OTHER,
      orgId: ORGANIZATION_ID,
      title: "Space page",
      content: "space body",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    // A share with the organization holds only while it is the active one,
    // which the space makes it for its members.
    await getDb().insert(schema.documentShares).values({
      id: "space-page-share",
      resourceId: "space-page",
      principalType: "org",
      principalId: ORGANIZATION_ID,
      role: "editor",
      createdBy: OTHER,
      createdAt: now,
    });
    await getDb().insert(schema.documentPreviewDrafts).values({
      id: "space-page-draft",
      ownerEmail: OWNER,
      documentId: "space-page",
      title: "Space page",
      content: "unsaved space body",
    });

    const page = await read("space-page", true);

    expect(page.canEdit).toBe(true);
    expect(page).not.toHaveProperty("previewDraft");
    await expect(readDraftOnItsOwn("space-page")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
