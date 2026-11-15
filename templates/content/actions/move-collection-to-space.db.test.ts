import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq, inArray } from "drizzle-orm";
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
  `move-collection-to-space-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let createDocument: typeof import("./create-document.js").default;
let createContentDatabase: typeof import("./create-content-database.js").default;
let createInlineContentDatabase: typeof import("./create-inline-content-database.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;
let moveDocument: typeof import("./move-document.js").default;
let duplicatePage: typeof import("./duplicate-page.js").default;
let organizationContentSpaceId: typeof import("./_content-spaces.js").organizationContentSpaceId;
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;

const OWNER = "owner@example.com";
const MEMBER = "member@example.com";
const OUTSIDER = "outsider@example.com";
const ORG_ID = "org-move-collections";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createDocument = (await import("./create-document.js")).default;
  createContentDatabase = (await import("./create-content-database.js"))
    .default;
  createInlineContentDatabase = (
    await import("./create-inline-content-database.js")
  ).default;
  configureDocumentProperty = (await import("./configure-document-property.js"))
    .default;
  getContentDatabase = (await import("./get-content-database.js")).default;
  addDatabaseItem = (await import("./add-database-item.js")).default;
  setDocumentProperty = (await import("./set-document-property.js")).default;
  moveDocument = (await import("./move-document.js")).default;
  duplicatePage = (await import("./duplicate-page.js")).default;
  ({ organizationContentSpaceId, personalContentSpaceId } =
    await import("./_content-spaces.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
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
    [MEMBER, "member"],
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
const asOwner = <T>(run: () => Promise<T>) => as(OWNER, run);

/** A collection with a Number Property, three rows with scores, and a view. */
async function seedCollection(title: string, parentId?: string) {
  return asOwner(async () => {
    const created = await createContentDatabase.run({
      title,
      ...(parentId ? { parentId } : {}),
    } as Parameters<typeof createContentDatabase.run>[0]);
    const databaseId = created.database.id as string;
    const documentId = created.database.documentId as string;
    const configured = await configureDocumentProperty.run({
      documentId,
      databaseId,
      name: "Score",
      type: "number",
    });
    const score = configured.properties.find(
      (property) => property.definition.name === "Score",
    );
    if (!score) throw new Error("The Score Property wasn't created.");
    const scoreId = score.definition.id;
    const rows: string[] = [];
    for (const [index, name] of ["First", "Second", "Third"].entries()) {
      const read = await getContentDatabase.run({ databaseId });
      if (!("database" in read) || !read.mutationContract)
        throw new Error("Fixture collection has no mutation contract.");
      const added = await addDatabaseItem.run({
        target: read.mutationContract.target,
        expectedSchemaRevision: read.mutationContract.schemaRevision,
        idempotencyKey: `${title}-${name}`,
        title: name,
      });
      const row = added.receipt.row.documentId as string;
      await setDocumentProperty.run({
        documentId: row,
        databaseId,
        propertyId: scoreId,
        value: (index + 1) * 10,
      });
      rows.push(row);
    }
    return { databaseId, documentId, scoreId, rows };
  });
}

async function collectionRow(databaseId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  return row;
}

async function memberships(databaseId: string) {
  return getDb()
    .select({
      id: schema.contentDatabaseItems.id,
      documentId: schema.contentDatabaseItems.documentId,
      position: schema.contentDatabaseItems.position,
      ownerEmail: schema.contentDatabaseItems.ownerEmail,
      orgId: schema.contentDatabaseItems.orgId,
    })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId))
    .orderBy(asc(schema.contentDatabaseItems.position));
}

async function pages(ids: string[]) {
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

async function scores(propertyId: string, rows: string[]) {
  const values: Array<{ documentId: string; valueJson: string }> = await getDb()
    .select({
      documentId: schema.documentPropertyValues.documentId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(schema.documentPropertyValues.propertyId, propertyId),
        inArray(schema.documentPropertyValues.documentId, rows),
      ),
    );
  return rows.map(
    (row) => values.find((value) => value.documentId === row)?.valueJson,
  );
}

async function expectStillInPersonal(databaseId: string, ids: string[]) {
  const personal = personalContentSpaceId(OWNER);
  expect(await collectionRow(databaseId)).toMatchObject({
    spaceId: personal,
    orgId: null,
  });
  for (const page of await pages(ids)) {
    expect(page).toMatchObject({ spaceId: personal, ownerEmail: OWNER });
  }
}

describe("moving a collection between Content spaces", () => {
  it("moves a collection by its page in place, with its rows, Properties, values, order and views, into the destination's access and Files", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const seed = await seedCollection("Article ideas");
    const viewConfigJson = JSON.stringify({
      activeViewId: "board",
      views: [{ id: "board", name: "Board", type: "board" }],
    });
    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson })
      .where(eq(schema.contentDatabases.id, seed.databaseId));
    const before = await memberships(seed.databaseId);
    await expect(
      as(MEMBER, () => getContentDatabase.run({ databaseId: seed.databaseId })),
    ).rejects.toThrow();

    await asOwner(() =>
      moveDocument.run({ id: seed.documentId, spaceId: orgSpaceId }),
    );

    expect(await collectionRow(seed.databaseId)).toMatchObject({
      id: seed.databaseId,
      documentId: seed.documentId,
      spaceId: orgSpaceId,
      ownerEmail: OWNER,
      orgId: ORG_ID,
      viewConfigJson,
    });
    const after = await memberships(seed.databaseId);
    expect(
      after.map(({ id, documentId, position }) => [id, documentId, position]),
    ).toEqual(
      before.map(({ id, documentId, position }) => [id, documentId, position]),
    );
    expect(after.map(({ documentId }) => documentId)).toEqual(seed.rows);
    for (const membership of after) {
      expect(membership).toMatchObject({ ownerEmail: OWNER, orgId: ORG_ID });
    }
    for (const page of await pages([seed.documentId, ...seed.rows])) {
      expect(page).toMatchObject({
        spaceId: orgSpaceId,
        ownerEmail: OWNER,
        orgId: ORG_ID,
        visibility: "org",
      });
      expect(await filesSpaces(page.id)).toEqual([orgSpaceId]);
    }
    for (const row of await pages(seed.rows)) {
      expect(row.parentId).toBe(seed.documentId);
    }
    const [property] = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, seed.scoreId));
    expect(property).toMatchObject({
      databaseId: seed.databaseId,
      ownerEmail: OWNER,
      orgId: ORG_ID,
    });
    expect(await scores(seed.scoreId, seed.rows)).toEqual(["10", "20", "30"]);

    // An organization member can now open it, and someone outside can't.
    const read = await as(MEMBER, () =>
      getContentDatabase.run({ databaseId: seed.databaseId }),
    );
    expect("database" in read && read.items.map((item) => item.id)).toEqual(
      after.map(({ id }) => id),
    );
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        getContentDatabase.run({ databaseId: seed.databaseId }),
      ),
    ).rejects.toThrow();
  });

  it("moves a collection with the page it's in", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const page = await asOwner(() => createDocument.run({ title: "Tracker" }));
    const seed = await seedCollection("Tasks", page.id);

    await asOwner(() => moveDocument.run({ id: page.id, spaceId: orgSpaceId }));

    expect(await collectionRow(seed.databaseId)).toMatchObject({
      spaceId: orgSpaceId,
      orgId: ORG_ID,
    });
    for (const moved of await pages([page.id, seed.documentId, ...seed.rows])) {
      expect(moved).toMatchObject({ spaceId: orgSpaceId, orgId: ORG_ID });
    }
    expect(await scores(seed.scoreId, seed.rows)).toEqual(["10", "20", "30"]);
  });

  it("gives a collection to the editor who moves it to their own space, who can then add rows to it", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const memberSpaceId = personalContentSpaceId(MEMBER);
    const seed = await seedCollection("Handoff");
    await asOwner(() =>
      moveDocument.run({ id: seed.documentId, spaceId: orgSpaceId }),
    );
    for (const id of [seed.documentId, ...seed.rows]) {
      await getDb()
        .insert(schema.documentShares)
        .values({
          id: `share-${id}-${MEMBER}`,
          resourceId: id,
          principalType: "user",
          principalId: MEMBER,
          role: "editor",
          createdBy: OWNER,
          createdAt: new Date().toISOString(),
        });
    }

    await as(MEMBER, () =>
      moveDocument.run({ id: seed.documentId, spaceId: memberSpaceId }),
    );

    expect(await collectionRow(seed.databaseId)).toMatchObject({
      spaceId: memberSpaceId,
      ownerEmail: MEMBER,
      orgId: null,
    });
    for (const membership of await memberships(seed.databaseId)) {
      expect(membership).toMatchObject({ ownerEmail: MEMBER, orgId: null });
    }
    const [property] = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, seed.scoreId));
    expect(property).toMatchObject({ ownerEmail: MEMBER, orgId: null });
    expect(await scores(seed.scoreId, seed.rows)).toEqual(["10", "20", "30"]);
    await expect(
      asOwner(() => getContentDatabase.run({ databaseId: seed.databaseId })),
    ).rejects.toThrow();

    const read = await as(MEMBER, () =>
      getContentDatabase.run({ databaseId: seed.databaseId }),
    );
    if (!("database" in read) || !read.mutationContract)
      throw new Error("The moved collection has no mutation contract.");
    const added = await as(MEMBER, () =>
      addDatabaseItem.run({
        target: read.mutationContract.target,
        expectedSchemaRevision: read.mutationContract.schemaRevision,
        idempotencyKey: "Handoff-Fourth",
        title: "Fourth",
      }),
    );
    expect(
      (await memberships(seed.databaseId)).map(({ documentId }) => documentId),
    ).toEqual([...seed.rows, added.receipt.row.documentId]);
  });

  it("moves an inline collection with its host page, and refuses it without the host", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const host = await asOwner(() => createDocument.run({ title: "Host" }));
    const inline = await asOwner(() =>
      createInlineContentDatabase.run({
        hostDocumentId: host.id,
        title: "Inline",
      }),
    );
    const databaseId = inline.database.id as string;
    const documentId = inline.database.documentId as string;

    await expect(
      asOwner(() => moveDocument.run({ id: documentId, spaceId: orgSpaceId })),
    ).rejects.toMatchObject({ errorCode: "COLLECTION_OUTSIDE_PAGE" });
    await expectStillInPersonal(databaseId, [host.id, documentId]);

    await asOwner(() => moveDocument.run({ id: host.id, spaceId: orgSpaceId }));
    expect(await collectionRow(databaseId)).toMatchObject({
      spaceId: orgSpaceId,
      ownerDocumentId: host.id,
    });
  });

  it("moves two related collections together, and refuses either one alone", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const page = await asOwner(() => createDocument.run({ title: "Planning" }));
    const people = await seedCollection("People", page.id);
    const projects = await seedCollection("Projects", page.id);
    await asOwner(() =>
      configureDocumentProperty.run({
        documentId: projects.documentId,
        databaseId: projects.databaseId,
        name: "Lead",
        type: "relation",
        options: { relation: { databaseId: people.databaseId } },
      }),
    );

    for (const alone of [projects, people]) {
      await expect(
        asOwner(() =>
          moveDocument.run({ id: alone.documentId, spaceId: orgSpaceId }),
        ),
      ).rejects.toMatchObject({ errorCode: "COLLECTION_RELATION_OUTSIDE" });
      await expectStillInPersonal(alone.databaseId, [
        alone.documentId,
        ...alone.rows,
      ]);
    }

    await asOwner(() => moveDocument.run({ id: page.id, spaceId: orgSpaceId }));
    for (const moved of [people, projects]) {
      expect(await collectionRow(moved.databaseId)).toMatchObject({
        spaceId: orgSpaceId,
      });
    }
  });

  it("refuses a row moved without its collection", async () => {
    const seed = await seedCollection("Reading list");
    await expect(
      asOwner(() =>
        moveDocument.run({
          id: seed.rows[0],
          spaceId: organizationContentSpaceId(ORG_ID),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "PAGE_IS_COLLECTION_ROW" });
    await expectStillInPersonal(seed.databaseId, [
      seed.documentId,
      ...seed.rows,
    ]);
  });

  it("refuses a collection whose row page lives under another page", async () => {
    const seed = await seedCollection("Scattered");
    const elsewhere = await asOwner(() =>
      createDocument.run({ title: "Elsewhere" }),
    );
    await getDb()
      .update(schema.documents)
      .set({ parentId: elsewhere.id })
      .where(eq(schema.documents.id, seed.rows[1]));
    await expect(
      asOwner(() =>
        moveDocument.run({
          id: seed.documentId,
          spaceId: organizationContentSpaceId(ORG_ID),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "COLLECTION_ROWS_OUTSIDE" });
    await expectStillInPersonal(seed.databaseId, [
      seed.documentId,
      ...seed.rows,
    ]);
  });

  it("refuses a collection with webhooks on it or its pages, or an outside source", async () => {
    const hooked = await seedCollection("Hooked");
    await getDb().insert(schema.contentWebhooks).values({
      id: "webhook-hooked",
      ownerEmail: OWNER,
      scopeType: "database",
      scopeId: hooked.databaseId,
      url: "https://example.com/hook",
      eventsJson: "[]",
      secretScope: "user",
      secretScopeId: OWNER,
      secretKey: "content-webhook-hooked",
      createdBy: OWNER,
    });
    const rowHooked = await seedCollection("Row hooked");
    await getDb().insert(schema.contentWebhooks).values({
      id: "webhook-row-hooked",
      ownerEmail: OWNER,
      scopeType: "document",
      scopeId: rowHooked.rows[0],
      url: "https://example.com/hook",
      eventsJson: "[]",
      secretScope: "user",
      secretScopeId: OWNER,
      secretKey: "content-webhook-row-hooked",
      createdBy: OWNER,
    });
    const sourced = await seedCollection("Sourced");
    await getDb().insert(schema.contentDatabaseSources).values({
      id: "source-sourced",
      ownerEmail: OWNER,
      databaseId: sourced.databaseId,
      sourceType: "github",
      sourceName: "docs",
      sourceTable: "docs",
    });

    for (const [seed, errorCode] of [
      [hooked, "COLLECTION_HAS_WEBHOOKS"],
      [rowHooked, "PAGE_HAS_WEBHOOKS"],
      [sourced, "COLLECTION_SOURCE_LINKED"],
    ] as const) {
      await expect(
        asOwner(() =>
          moveDocument.run({
            id: seed.documentId,
            spaceId: organizationContentSpaceId(ORG_ID),
          }),
        ),
      ).rejects.toMatchObject({ errorCode });
      await expectStillInPersonal(seed.databaseId, [
        seed.documentId,
        ...seed.rows,
      ]);
    }
  });

  it("still refuses to copy a page with a collection to another space", async () => {
    const page = await asOwner(() => createDocument.run({ title: "Board" }));
    await seedCollection("Copied", page.id);
    await expect(
      asOwner(() =>
        duplicatePage.run({
          documentId: page.id,
          spaceId: organizationContentSpaceId(ORG_ID),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "PAGE_CONTAINS_COLLECTION" });
  });
});
