import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq, inArray } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { documentsPositionScope, withPositionLock } from "./_position-utils.js";

const OWNER = "duplicate-owner@example.com";
const VIEWER = "duplicate-viewer@example.com";
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let duplicate: typeof import("./duplicate-document.js").default;
let identity: typeof import("./_blocks-field-identity.js");

beforeAll(async () => {
  process.env.DATABASE_URL = "pglite:memory";
  ({ getDb, schema } = await import("../server/db/index.js"));
  duplicate = (await import("./duplicate-document.js")).default;
  identity = await import("./_blocks-field-identity.js");
  await (
    await import("../server/plugins/db.js")
  ).runContentMigrations(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
    joined_at BIGINT NOT NULL, federation_removal_pending_at BIGINT
  )`);
}, 60_000);

beforeEach(async () => {
  const db = getDb();
  for (const table of [
    schema.documentDuplicationReceipts,
    schema.documentBlocks,
    schema.documentBlockFields,
    schema.documentBlockFieldContents,
    schema.documentPropertyValues,
    schema.documentPropertyDefinitions,
    schema.documentVersions,
    schema.documentShares,
    schema.documentComments,
    schema.documentSyncLinks,
    schema.contentDatabaseSourceRows,
    schema.contentSpaceCatalogItems,
    schema.contentDatabaseItems,
    schema.contentDatabases,
    schema.contentSpaces,
    schema.documents,
  ])
    await db.delete(table);
  await db.insert(schema.documents).values({
    id: "files-page",
    title: "Files",
    ownerEmail: OWNER,
    spaceId: "space",
  });
  await db.insert(schema.contentSpaces).values({
    id: "space",
    name: "Personal",
    kind: "personal",
    ownerEmail: OWNER,
    filesDatabaseId: "files",
    createdBy: OWNER,
  });
  await db.insert(schema.contentDatabases).values({
    id: "files",
    documentId: "files-page",
    spaceId: "space",
    ownerEmail: OWNER,
    systemRole: "files",
    primaryBlocksPropertyId: "body",
    blocksSeeded: 1,
  });
  await db.insert(schema.documentPropertyDefinitions).values({
    id: "body",
    ownerEmail: OWNER,
    databaseId: "files",
    name: "Content",
    type: "blocks",
  });
  await db.insert(schema.documents).values([
    {
      id: "root",
      title: "Original",
      content:
        "# Original\n\n[Reference](/page/child)\n\n![Image](https://example.com/image.png)",
      ownerEmail: OWNER,
      spaceId: "space",
      visibility: "public",
      description: "Page guidance",
      isFavorite: 1,
    },
    {
      id: "child",
      parentId: "root",
      title: "Child",
      content: "Child body",
      ownerEmail: OWNER,
      spaceId: "space",
      position: 3,
    },
    {
      id: "grandchild",
      parentId: "child",
      title: "Grandchild",
      content: "Grandchild body",
      ownerEmail: OWNER,
      spaceId: "space",
    },
  ]);
});

function copy(idempotencyKey = "request", userEmail = OWNER) {
  return runWithRequestContext({ userEmail }, () =>
    duplicate.run(
      { id: "root", idempotencyKey },
      { caller: "frontend", userEmail },
    ),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("atomic native subtree duplication", () => {
  it("clones Page definitions for a different organization member and can duplicate that copy again", async () => {
    const db = getDb();
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id,name,created_by,created_at) VALUES ($1,$2,$3,$4)",
      args: ["org", "Example organization", OWNER, Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ($1,$2,$3,$4,$5)",
      args: ["member", "org", VIEWER, "member", Date.now()],
    });
    await db
      .update(schema.contentSpaces)
      .set({ orgId: "org", kind: "organization" });
    await db.update(schema.documents).set({ orgId: "org" });
    await db.update(schema.contentDatabases).set({ orgId: "org" });
    await db.insert(schema.documentShares).values(
      ["root", "child", "grandchild"].map((id) => ({
        id: `share-${id}`,
        resourceId: id,
        principalType: "user" as const,
        principalId: VIEWER,
        role: "editor" as const,
        createdBy: OWNER,
      })),
    );
    await db.insert(schema.documentPropertyDefinitions).values([
      {
        id: "relation",
        ownerEmail: OWNER,
        orgId: "org",
        type: "relation",
        name: "Related",
        optionsJson: '{"relation":{"databaseId":"external"}}',
      },
      {
        id: "rollup",
        ownerEmail: OWNER,
        orgId: "org",
        type: "rollup",
        name: "Count",
        optionsJson:
          '{"rollup":{"relationPropertyId":"relation","targetPropertyId":"external-field","aggregation":"count"}}',
      },
      {
        id: "extra",
        ownerEmail: OWNER,
        orgId: "org",
        type: "blocks",
        name: "Extra",
      },
    ]);
    await db.insert(schema.documentPropertyValues).values([
      {
        id: "relation-value",
        ownerEmail: OWNER,
        documentId: "root",
        propertyId: "relation",
        valueJson: '["child"]',
      },
      {
        id: "rollup-value",
        ownerEmail: OWNER,
        documentId: "root",
        propertyId: "rollup",
        valueJson: "1",
      },
    ]);
    await db.insert(schema.documentBlockFieldContents).values({
      id: "extra-value",
      ownerEmail: OWNER,
      documentId: "child",
      propertyId: "extra",
      content: "Extra owned content",
    });
    const invoke = (id: string, idempotencyKey: string) =>
      runWithRequestContext({ userEmail: VIEWER, orgId: "org" }, () =>
        duplicate.run(
          { id, idempotencyKey },
          { caller: "frontend", userEmail: VIEWER, orgId: "org" },
        ),
      );
    const first = await invoke("root", "cross-owner");
    const firstDefinitions = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.ownerEmail, VIEWER));
    expect(firstDefinitions).toHaveLength(3);
    const relation = firstDefinitions.find(
      (definition) => definition.type === "relation",
    )!;
    const rollup = firstDefinitions.find(
      (definition) => definition.type === "rollup",
    )!;
    expect(relation.id).not.toBe("relation");
    expect(JSON.parse(rollup.optionsJson).rollup).toMatchObject({
      relationPropertyId: relation.id,
      targetPropertyId: "external-field",
    });
    const values = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.documentId, first.id));
    expect(
      values.find((value) => value.propertyId === relation.id)?.valueJson,
    ).toBe('["child"]');
    const second = await invoke(first.id, "copy-the-copy");
    expect(second.duplicatedCount).toBe(3);
    const secondFields = await db
      .select()
      .from(schema.documentBlockFieldContents)
      .where(
        inArray(
          schema.documentBlockFieldContents.documentId,
          second.documentIds.map((entry) => entry.id),
        ),
      );
    expect(secondFields).toMatchObject([
      { ownerEmail: VIEWER, content: "Extra owned content" },
    ]);
    expect(
      firstDefinitions.every(
        (definition) => definition.id !== secondFields[0].propertyId,
      ),
    ).toBe(true);
    const { getContentDatabasePageResponse } =
      await import("./_database-utils.js");
    const list = (userEmail: string, offset = 0, documentIds?: string[]) =>
      runWithRequestContext({ userEmail, orgId: "org" }, () =>
        getContentDatabasePageResponse("files", {
          limit: 1,
          offset,
          includeSources: false,
          documentIds,
        }),
      );
    const copiedIds = [...first.documentIds, ...second.documentIds].map(
      (entry) => entry.id,
    );
    const seen = new Set<string>();
    for (let offset = 0; offset < copiedIds.length; offset++) {
      const page = await list(VIEWER, offset);
      expect(page.pagination).toMatchObject({
        totalItems: 6,
        returnedItems: 1,
        hasMore: offset < 5,
      });
      expect(page.items).toHaveLength(1);
      seen.add(page.items[0].document.id);
    }
    expect(seen).toEqual(new Set(copiedIds));
    const otherMember = await list(OWNER);
    expect(otherMember.items).toEqual([]);
    expect(otherMember.pagination).toMatchObject({
      totalItems: 0,
      returnedItems: 0,
      hasMore: false,
    });
    const targetedPrivateRead = await list(OWNER, 0, [first.id]);
    expect(targetedPrivateRead.items).toEqual([]);
    expect(targetedPrivateRead.pagination?.totalItems).toBe(0);
  });

  it("waits for the shared root allocator and appends after another space's root", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ordinaryRoot = withPositionLock(
      documentsPositionScope(OWNER, null),
      async () => {
        await held;
        await getDb().insert(schema.documents).values({
          id: "ordinary-root",
          ownerEmail: OWNER,
          spaceId: "other-space",
          position: 30,
          title: "Created concurrently",
        });
      },
    );
    let completed = false;
    const pending = copy().then((result) => {
      completed = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(completed).toBe(false);
    release();
    await ordinaryRoot;
    const result = await pending;
    const [root] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, result.id));
    expect(root.position).toBe(31);
  });

  it("keeps shared Files visibility, hidden organization rows and foreign-organization isolation intact", async () => {
    const db = getDb();
    await db
      .update(schema.contentDatabases)
      .set({ orgId: "org" })
      .where(eq(schema.contentDatabases.id, "files"));
    await db.update(schema.documents).set({ orgId: "org" });
    await db
      .update(schema.documents)
      .set({ visibility: "org", hideFromSearch: 1 })
      .where(eq(schema.documents.id, "grandchild"));
    await db
      .insert(schema.documents)
      .values({
        id: "foreign",
        title: "Another organization",
        ownerEmail: VIEWER,
        spaceId: "space",
        orgId: "other-org",
        visibility: "private",
      });
    await db
      .insert(schema.contentDatabaseItems)
      .values(
        ["root", "child", "grandchild", "foreign"].map((id, position) => ({
          id: `files-${id}`,
          databaseId: "files",
          documentId: id,
          ownerEmail: OWNER,
          position,
        })),
      );
    const { getContentDatabasePageResponse } =
      await import("./_database-utils.js");
    const list = (userEmail: string) =>
      runWithRequestContext({ userEmail, orgId: "org" }, () =>
        getContentDatabasePageResponse("files", {
          limit: 20,
          includeSources: false,
        }),
      );
    const owner = await list(OWNER);
    expect(owner.items.map((item) => item.document.id)).toEqual([
      "root",
      "child",
    ]);
    expect(owner.pagination?.totalItems).toBe(2);
    const member = await list(VIEWER);
    expect(member.items.map((item) => item.document.id)).toEqual(["root"]);
    expect(member.pagination?.totalItems).toBe(1);
  });

  it("copies all native children with new identities, exact content, private access and only Files membership", async () => {
    const db = getDb();
    await db.insert(schema.documents).values({
      id: "member",
      title: "Membership is not containment",
      ownerEmail: OWNER,
      spaceId: "space",
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: "membership",
      databaseId: "files",
      documentId: "member",
      ownerEmail: OWNER,
    });
    await db.insert(schema.documentPropertyDefinitions).values([
      { id: "page-value", name: "Page value", type: "text", ownerEmail: OWNER },
      { id: "extra", name: "Extra body", type: "blocks", ownerEmail: OWNER },
      {
        id: "member-value",
        name: "Membership value",
        type: "text",
        databaseId: "files",
        ownerEmail: OWNER,
      },
    ]);
    await db.insert(schema.documentPropertyValues).values([
      {
        id: "value",
        documentId: "root",
        propertyId: "page-value",
        ownerEmail: OWNER,
        valueJson: '"kept"',
      },
      {
        id: "excluded",
        documentId: "root",
        propertyId: "member-value",
        ownerEmail: OWNER,
        valueJson: '"not cloned"',
      },
    ]);
    await db.insert(schema.documentBlockFieldContents).values({
      id: "extra-content",
      documentId: "child",
      propertyId: "extra",
      ownerEmail: OWNER,
      content: "Extra body [link](/page/root)",
    });
    await identity.persistBlocksFieldIdentity({
      db,
      documentId: "child",
      propertyId: "body",
      ownerEmail: OWNER,
      previousMarkdown: "",
      markdown: "Child body",
      now: new Date().toISOString(),
    });
    const beforeBlocks = await db.select().from(schema.documentBlocks);
    await db.insert(schema.documentShares).values({
      id: "original-share",
      resourceId: "root",
      principalType: "user",
      principalId: VIEWER,
      role: "viewer",
      createdBy: OWNER,
    });
    const result = await copy();
    expect(result).toMatchObject({
      sourceDocumentId: "root",
      duplicatedCount: 3,
      placement: "root",
      visibility: "private",
      spaceId: "space",
      replayed: false,
    });
    const mapping = new Map(
      result.documentIds.map((entry) => [entry.sourceId, entry.id]),
    );
    const copies = await db
      .select()
      .from(schema.documents)
      .where(inArray(schema.documents.id, [...mapping.values()]));
    expect(copies).toHaveLength(3);
    const original = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, "root"));
    expect(copies.find((page) => page.id === result.id)).toMatchObject({
      parentId: null,
      title: "Original",
      description: "Page guidance",
      content: original[0].content,
    });
    expect(
      copies.find((page) => page.id === mapping.get("grandchild"))?.parentId,
    ).toBe(mapping.get("child"));
    for (const page of copies)
      expect(page).toMatchObject({
        ownerEmail: OWNER,
        visibility: "private",
        isFavorite: 0,
        sourceMode: null,
      });
    expect(
      await db
        .select()
        .from(schema.documentShares)
        .where(
          inArray(schema.documentShares.resourceId, [...mapping.values()]),
        ),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.contentDatabaseItems)
        .where(
          inArray(schema.contentDatabaseItems.documentId, [
            ...mapping.values(),
          ]),
        ),
    ).toHaveLength(3);
    expect(
      await db
        .select()
        .from(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.documentId, result.id)),
    ).toMatchObject([{ valueJson: '"kept"' }]);
    expect(
      await db
        .select()
        .from(schema.documentBlockFieldContents)
        .where(
          eq(
            schema.documentBlockFieldContents.documentId,
            mapping.get("child")!,
          ),
        ),
    ).toMatchObject([{ content: "Extra body [link](/page/root)" }]);
    const fields = await db
      .select()
      .from(schema.documentBlockFields)
      .where(
        inArray(schema.documentBlockFields.documentId, [...mapping.values()]),
      );
    expect(fields).toHaveLength(4);
    const blocks = await db
      .select()
      .from(schema.documentBlocks)
      .where(
        inArray(
          schema.documentBlocks.fieldId,
          fields.map((field) => field.id),
        ),
      );
    expect(blocks.length).toBeGreaterThan(3);
    expect(
      blocks.every((block) => !beforeBlocks.some((old) => old.id === block.id)),
    ).toBe(true);
    expect(
      await db
        .select()
        .from(schema.documentVersions)
        .where(
          inArray(schema.documentVersions.documentId, [...mapping.values()]),
        ),
    ).toHaveLength(3);
  });

  it("replays concurrent delivery without another tree and rejects key reuse", async () => {
    const [first, second] = await Promise.all([copy(), copy()]);
    expect(first.id).toBe(second.id);
    expect(new Set([first.replayed, second.replayed])).toEqual(
      new Set([false, true]),
    );
    expect(
      await getDb().select().from(schema.documentDuplicationReceipts),
    ).toHaveLength(1);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        duplicate.run(
          { id: "child", idempotencyKey: "request" },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rejects an inaccessible child without creating a partial copy", async () => {
    await getDb()
      .update(schema.documents)
      .set({ ownerEmail: VIEWER, visibility: "private" })
      .where(eq(schema.documents.id, "child"));
    await expect(copy()).rejects.toMatchObject({
      errorCode: "PAGE_TREE_UNAVAILABLE",
    });
    expect(await getDb().select().from(schema.documents)).toHaveLength(4);
    expect(
      await getDb().select().from(schema.documentDuplicationReceipts),
    ).toEqual([]);
  });

  it("rejects viewer authority and shared access without space creation authority", async () => {
    await getDb().insert(schema.documentShares).values({
      id: "shared",
      resourceId: "root",
      principalType: "user",
      principalId: VIEWER,
      role: "viewer",
      createdBy: OWNER,
    });
    await expect(copy("viewer", VIEWER)).rejects.toMatchObject({
      errorCode: "PAGE_UNAVAILABLE",
    });
    await getDb().update(schema.documentShares).set({ role: "editor" });
    await getDb()
      .delete(schema.documents)
      .where(inArray(schema.documents.id, ["child", "grandchild"]));
    await expect(copy("editor", VIEWER)).rejects.toMatchObject({
      errorCode: "SPACE_CREATION_DENIED",
    });
    expect(
      await getDb().select().from(schema.documentDuplicationReceipts),
    ).toEqual([]);
  });

  it.each(["source", "database", "ephemeral"])(
    "rejects an unsupported %s descendant atomically",
    async (kind) => {
      const db = getDb();
      if (kind === "source")
        await db
          .update(schema.documents)
          .set({ sourceKind: "unknown" })
          .where(eq(schema.documents.id, "grandchild"));
      if (kind === "database")
        await db.insert(schema.contentDatabases).values({
          id: "embedded",
          documentId: "child",
          spaceId: "space",
          ownerEmail: OWNER,
        });
      if (kind === "ephemeral")
        await db
          .update(schema.documents)
          .set({ content: "![pending](blob:example)" })
          .where(eq(schema.documents.id, "child"));
      await expect(copy()).rejects.toThrow();
      expect(await db.select().from(schema.documents)).toHaveLength(4);
      expect(await db.select().from(schema.documentVersions)).toEqual([]);
      expect(
        await db.select().from(schema.documentDuplicationReceipts),
      ).toEqual([]);
    },
  );

  it("excludes trashed children without restoring or copying their descendants", async () => {
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, "child"));
    const result = await copy();
    expect(result.duplicatedCount).toBe(1);
  });

  it("rejects ambiguous database-parent containment", async () => {
    await getDb()
      .update(schema.documents)
      .set({ parentId: "files-page" })
      .where(eq(schema.documents.id, "root"));
    await expect(copy()).rejects.toMatchObject({
      errorCode: "AMBIGUOUS_DATABASE_PARENT",
    });
  });

  it("rolls back Pages, history, Blocks and receipts if a later write fails, then permits the same retry", async () => {
    vi.spyOn(identity, "persistBlocksFieldIdentity").mockRejectedValueOnce(
      new Error("Injected storage failure"),
    );
    await expect(copy()).rejects.toThrow("Injected storage failure");
    expect(await getDb().select().from(schema.documents)).toHaveLength(4);
    expect(await getDb().select().from(schema.documentVersions)).toEqual([]);
    expect(await getDb().select().from(schema.documentBlockFields)).toEqual([]);
    expect(
      await getDb().select().from(schema.documentDuplicationReceipts),
    ).toEqual([]);
    const result = await copy();
    expect(result.duplicatedCount).toBe(3);
  });

  it("detects a Source binding even when the document's source columns are empty", async () => {
    await getDb().insert(schema.documentSyncLinks).values({
      documentId: "child",
      ownerEmail: OWNER,
      remotePageId: "example-remote-page",
    });
    await expect(copy()).rejects.toMatchObject({
      errorCode: "SOURCE_DUPLICATION_UNSUPPORTED",
    });
    expect(
      await getDb().select().from(schema.documentDuplicationReceipts),
    ).toEqual([]);
  });

  it("does not create another copy when the previous result was trashed before retry", async () => {
    const first = await copy();
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, first.id));
    await expect(copy()).rejects.toMatchObject({
      errorCode: "DUPLICATE_UNAVAILABLE",
    });
    expect(
      await getDb().select().from(schema.documentDuplicationReceipts),
    ).toHaveLength(1);
  });
});
