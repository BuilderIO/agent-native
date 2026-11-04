import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { firstRow } from "../server/lib/first-row.js";

// guard:allow-unscoped — isolated fixtures inspect only the synthetic collection and source records they created.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-source-attachment-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "synthetic-source-attachment@example.test";
const STAMP = "2026-01-01T00:00:00.000Z";
type Db = ReturnType<typeof import("../server/db/index.js").getDb>;
let getDb: () => Db;
let schema: typeof import("../server/db/schema.js");
let replaceSourceMetadata: typeof import("./_database-source-utils.js").replaceSourceMetadata;
let insertSecondarySource: typeof import("./_database-source-utils.js").insertSecondarySource;
let sequence = 0;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  await (await import("../server/plugins/db.js")).default(undefined as never);
  ({ replaceSourceMetadata, insertSecondarySource } =
    await import("./_database-source-utils.js"));
}, 60_000);

afterAll(() => {
  expect(dirname(TEST_DB_PATH)).toBe(tmpdir());
  rmSync(TEST_DB_PATH, { recursive: true, force: true });
});

type Mode = "first" | "replace" | "secondary";

function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("Missing source attachment fixture.");
  return value;
}

async function fixture(
  mode: Mode,
  switched: boolean,
  content = "Body to keep",
) {
  const key = `synthetic-source-attachment-${++sequence}`;
  const databaseId = `${key}-collection`;
  const documentId = `${key}-row`;
  const sourceId = `${key}-source`;
  const db = getDb();
  await db.insert(schema.documents).values([
    {
      id: key,
      ownerEmail: OWNER,
      title: "Collection",
      content: "",
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      title: "Row",
      content,
      liveBodySwitchedAt: switched ? STAMP : null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ]);
  const [database] = await db
    .insert(schema.contentDatabases)
    .values({
      id: databaseId,
      ownerEmail: OWNER,
      documentId: key,
      title: "Collection",
      createdAt: STAMP,
      updatedAt: STAMP,
    })
    .returning();
  await db.insert(schema.contentDatabaseItems).values({
    id: `${key}-membership`,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  if (mode !== "first") {
    await db.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "mock-local",
      sourceName: "Original",
      sourceTable: "original",
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    await db.insert(schema.contentDatabaseSourceFields).values({
      id: `${key}-field`,
      ownerEmail: OWNER,
      sourceId,
      localFieldKey: "title",
      sourceFieldKey: "title",
      sourceFieldLabel: "Title",
      sourceFieldType: "text",
    });
    await db.insert(schema.contentDatabaseSourceChangeSets).values({
      id: `${key}-change`,
      ownerEmail: OWNER,
      sourceId,
      summary: "Keep pending change",
    });
    await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
      id: `${key}-hydration`,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: `${key}-membership`,
      documentId,
      sourceRowId: "original-row",
      sourceTable: "original",
    });
  }
  const sources = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));
  return {
    database: required(database),
    source: firstRow(sources) ?? null,
    sourceId,
    documentId,
    key,
    mode,
  };
}

async function snapshot(seed: Awaited<ReturnType<typeof fixture>>) {
  const db = getDb();
  const [
    documents,
    databases,
    memberships,
    sources,
    fields,
    changes,
    hydration,
  ] = await Promise.all([
    db
      .select()
      .from(schema.documents)
      .where(inArray(schema.documents.id, [seed.key, seed.documentId])),
    db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, seed.database.id)),
    db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seed.database.id)),
    db
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, seed.database.id)),
    db
      .select()
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.sourceId, seed.sourceId)),
    db
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        eq(schema.contentDatabaseSourceChangeSets.sourceId, seed.sourceId),
      ),
    db
      .select()
      .from(schema.contentDatabaseBodyHydrationQueue)
      .where(
        eq(schema.contentDatabaseBodyHydrationQueue.sourceId, seed.sourceId),
      ),
  ]);
  return {
    documents,
    databases,
    memberships,
    sources,
    fields,
    changes,
    hydration,
  };
}

function attach(seed: Awaited<ReturnType<typeof fixture>>) {
  const args = {
    database: seed.database,
    sourceType: "mock-local" as const,
    sourceName: "Replacement",
    sourceTable: "replacement",
    now: "2026-11-04T00:00:00.000Z",
  };
  return seed.mode === "secondary"
    ? insertSecondarySource({ ...args, expectedPrimarySourceId: seed.sourceId })
    : replaceSourceMetadata({ ...args, source: seed.source });
}

it.each(["first", "replace", "secondary"] as const)(
  "keeps %s source attachment available on legacy rows",
  async (mode) => {
    const seed = await fixture(mode, false);
    const sourceId = await attach(seed);
    const [source] = await getDb()
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, sourceId));
    expect(source).toMatchObject({
      databaseId: seed.database.id,
      sourceName: "Replacement",
      sourceTable: "replacement",
    });
    const state = await snapshot(seed);
    expect(state.sources).toHaveLength(mode === "secondary" ? 2 : 1);
    expect(
      state.documents.find((document) => document.id === seed.documentId),
    ).toMatchObject({
      content: "Body to keep",
      liveBodySwitchedAt: null,
      updatedAt: STAMP,
    });
  },
);

it.each([
  ["first", "Body to keep"],
  ["replace", "Body to keep"],
  ["secondary", "Body to keep"],
  ["first", ""],
  ["replace", ""],
  ["secondary", ""],
] as const)(
  "refuses %s source attachment to a switched row with body %j before changing source records",
  async (mode, content) => {
    const seed = await fixture(mode, true, content);
    const before = await snapshot(seed);
    await expect(attach(seed)).rejects.toMatchObject({
      errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
      statusCode: 409,
      details: {
        documentId: seed.documentId,
        operation: "attach-content-database-source",
      },
    });
    expect(await snapshot(seed)).toEqual(before);
  },
);

it("refuses a removed source without clearing its retained records", async () => {
  const seed = await fixture("replace", false);
  await getDb()
    .delete(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, seed.sourceId));
  const before = await snapshot(seed);
  await expect(attach(seed)).rejects.toMatchObject({
    errorCode: "source_state_changed",
    statusCode: 409,
  });
  expect(await snapshot(seed)).toEqual(before);
});

it("rolls source cleanup back when replacement metadata cannot commit", async () => {
  const seed = await fixture("replace", false);
  const before = await snapshot(seed);
  const db = getDb();
  await db.execute(
    sql.raw(
      `CREATE FUNCTION refuse_source_replacement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic source replacement refusal'; END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TRIGGER refuse_source_replacement BEFORE UPDATE ON content_database_sources FOR EACH ROW EXECUTE FUNCTION refuse_source_replacement()`,
    ),
  );
  try {
    await expect(attach(seed)).rejects.toThrow(
      "synthetic source replacement refusal",
    );
    expect(await snapshot(seed)).toEqual(before);
  } finally {
    await db.execute(
      sql.raw(
        "DROP TRIGGER refuse_source_replacement ON content_database_sources",
      ),
    );
    await db.execute(sql.raw("DROP FUNCTION refuse_source_replacement()"));
  }
});
