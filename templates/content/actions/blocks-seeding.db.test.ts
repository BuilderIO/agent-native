// Integration tests for the DB-enforced single-primary Blocks invariant and the
// independent block-field content store. Boots a real libsql (SQLite) database
// in-memory, runs the actual versioned migrations, then drives the store-layer
// functions directly — the seam where review findings 1, 4, 5, and 7 live.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  countWords,
  formatWordCount,
  isPrimaryBlocksField,
} from "../shared/properties.js";

// A unique on-disk SQLite file in the OS temp dir, removed after the run. Kept
// out of the repo working tree and isolated from the process-wide getDbExec
// singleton other test files share.
const TEST_DB_PATH = join(
  tmpdir(),
  `blocks-seeding-test-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let propertyUtils: typeof import("./_property-utils.js");
let databaseUtils: typeof import("./_database-utils.js");
let createInlineContentDatabaseAction: typeof import("./create-inline-content-database.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  propertyUtils = await import("./_property-utils.js");
  databaseUtils = await import("./_database-utils.js");
  createInlineContentDatabaseAction = (
    await import("./create-inline-content-database.js")
  ).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000); // cold-import of the db module + migrations exceeds the default 10s hook timeout

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let counter = 0;
async function createDatabaseRow(opts: { seeded?: boolean } = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = `db_${++counter}_${Math.random().toString(36).slice(2, 8)}`;
  const documentId = `doc_${id}`;
  await db.insert(schema.documents).values({
    id: documentId,
    ownerEmail: OWNER,
    title: "Untitled",
    content: "body text",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id,
    ownerEmail: OWNER,
    documentId,
    title: "Test DB",
    blocksSeeded: opts.seeded ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
  return { databaseId: id, documentId };
}

async function blocksDefinitions(databaseId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.databaseId, databaseId),
        eq(schema.documentPropertyDefinitions.type, "blocks"),
      ),
    );
}

describe("seedDefaultBlocksField — single-primary invariant (findings 1, 2)", () => {
  it("seeds exactly one primary and is idempotent on repeat calls", async () => {
    const { databaseId } = await createDatabaseRow();
    const now = new Date().toISOString();

    const id1 = await propertyUtils.seedDefaultBlocksField({
      databaseId,
      ownerEmail: OWNER,
      orgId: null,
      now,
    });
    const id2 = await propertyUtils.seedDefaultBlocksField({
      databaseId,
      ownerEmail: OWNER,
      orgId: null,
      now,
    });

    expect(id1).toBe(id2);
    expect(await blocksDefinitions(databaseId)).toHaveLength(1);

    const db = getDb();
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    expect(database.primaryBlocksPropertyId).toBe(id1);
    expect(database.blocksSeeded).toBe(1);
  });

  it("creates ONLY ONE primary under concurrent seeding (no aliasing)", async () => {
    const { databaseId } = await createDatabaseRow();
    const now = new Date().toISOString();

    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        propertyUtils.seedDefaultBlocksField({
          databaseId,
          ownerEmail: OWNER,
          orgId: null,
          now,
        }),
      ),
    );

    // Every concurrent caller resolves to the SAME primary id...
    expect(new Set(ids).size).toBe(1);
    // ...and there is exactly one primary Blocks definition in the DB.
    const defs = await blocksDefinitions(databaseId);
    expect(defs).toHaveLength(1);
    expect(propertyUtils).toBeDefined();
  });
});

describe("create-inline-content-database", () => {
  it("creates a child database and stamps inline ownership metadata", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const hostDocumentId = `host_inline_${++counter}`;
    await db.insert(schema.documents).values({
      id: hostDocumentId,
      ownerEmail: OWNER,
      title: "Host page",
      content: "",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      createInlineContentDatabaseAction.run({
        hostDocumentId,
        title: "Inline tasks",
      }),
    );

    expect(result.database.title).toBe("Inline tasks");
    expect(result.block.databaseId).toBe(result.database.id);
    expect(result.block.databaseDocumentId).toBe(result.database.documentId);
    expect(result.block.ownerBlockId).toMatch(/^inline-database-/);

    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, result.database.id));
    expect(database.ownerDocumentId).toBe(hostDocumentId);
    expect(database.ownerBlockId).toBe(result.block.ownerBlockId);

    const [databaseDocument] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, result.database.documentId));
    expect(databaseDocument.parentId).toBe(hostDocumentId);
  });
});

describe("read paths do not mutate (finding 2)", () => {
  it("getContentDatabaseResponse does not seed an unseeded database", async () => {
    const { databaseId } = await createDatabaseRow();

    await databaseUtils.getContentDatabaseResponse(databaseId);

    const db = getDb();
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    // Pure read: never flips blocksSeeded or creates a primary.
    expect(database.blocksSeeded).toBe(0);
    expect(database.primaryBlocksPropertyId).toBeNull();
    expect(await blocksDefinitions(databaseId)).toHaveLength(0);
  });

  it("getContentDatabaseResponse omits row document bodies from table payloads", async () => {
    const { databaseId, documentId: databaseDocumentId } =
      await createDatabaseRow();
    const db = getDb();
    const now = new Date().toISOString();
    const rowDocumentId = `row_doc_${databaseId}`;
    const largeBody = "Builder body paragraph. ".repeat(1_000);
    await db.insert(schema.documents).values({
      id: rowDocumentId,
      ownerEmail: OWNER,
      parentId: databaseDocumentId,
      title: "Hydrated Builder row",
      content: largeBody,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: `item_${databaseId}`,
      ownerEmail: OWNER,
      databaseId,
      documentId: rowDocumentId,
      position: 0,
      bodyHydrationStatus: "hydrated",
      createdAt: now,
      updatedAt: now,
    });

    const response = await databaseUtils.getContentDatabaseResponse(databaseId);

    expect(response.items).toHaveLength(1);
    expect(response.items[0].document.title).toBe("Hydrated Builder row");
    expect(response.items[0].document.content).toBe("");
    const [stored] = await db
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, rowDocumentId));
    expect(stored.content).toBe(largeBody);
  });

  it("listPropertiesForDocument does not seed when opening a row", async () => {
    const { databaseId, documentId } = await createDatabaseRow();
    const db = getDb();
    const now = new Date().toISOString();
    await db.insert(schema.contentDatabaseItems).values({
      id: `item_${databaseId}`,
      ownerEmail: OWNER,
      databaseId,
      documentId,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));

    await propertyUtils.listPropertiesForDocument(document);

    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    expect(database.blocksSeeded).toBe(0);
    expect(await blocksDefinitions(databaseId)).toHaveLength(0);
  });
});

describe("repairUnseededBlocksFields — one-time startup repair (finding 2)", () => {
  it("seeds an unseeded legacy database exactly once", async () => {
    const { databaseId } = await createDatabaseRow();

    const firstRun = await propertyUtils.repairUnseededBlocksFields();
    expect(firstRun).toBeGreaterThanOrEqual(1);
    expect(await blocksDefinitions(databaseId)).toHaveLength(1);

    // Re-running is a no-op for this already-seeded database.
    await propertyUtils.repairUnseededBlocksFields();
    expect(await blocksDefinitions(databaseId)).toHaveLength(1);
  });
});

describe("legacy adoption — existing primary is not duplicated (findings 1, 2)", () => {
  it("adopts a legacy primary definition instead of creating a second one", async () => {
    const { databaseId } = await createDatabaseRow();
    const db = getDb();
    const now = new Date().toISOString();
    // Simulate a database seeded by the OLD read-path safety net: a primary
    // "Content" definition exists but the new column is still NULL and
    // blocks_seeded is 0 (the v52 backfill "didn't run" for it).
    const legacyId = `legacy_primary_${databaseId}`;
    await db.insert(schema.documentPropertyDefinitions).values({
      id: legacyId,
      ownerEmail: OWNER,
      databaseId,
      name: "Content",
      type: "blocks",
      visibility: "always_show",
      optionsJson: JSON.stringify({ blocks: { primary: true } }),
      position: 0,
      createdAt: now,
      updatedAt: now,
    });

    const adopted = await propertyUtils.seedDefaultBlocksField({
      databaseId,
      ownerEmail: OWNER,
      orgId: null,
      now,
    });

    expect(adopted).toBe(legacyId);
    // No duplicate primary was created.
    expect(await blocksDefinitions(databaseId)).toHaveLength(1);
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    expect(database.primaryBlocksPropertyId).toBe(legacyId);
    expect(database.blocksSeeded).toBe(1);
  });
});

describe("intentionally-deleted primary is never reseeded (finding 5)", () => {
  it("seedDefaultBlocksField does not recreate a deleted primary", async () => {
    const { databaseId } = await createDatabaseRow();
    const now = new Date().toISOString();
    const primaryId = await propertyUtils.seedDefaultBlocksField({
      databaseId,
      ownerEmail: OWNER,
      orgId: null,
      now,
    });

    const db = getDb();
    // Simulate delete-document-property removing the only primary:
    await db
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, primaryId));
    await db
      .update(schema.contentDatabases)
      .set({ primaryBlocksPropertyId: null })
      .where(eq(schema.contentDatabases.id, databaseId));

    // Neither a re-seed nor the startup repair recreates it (blocks_seeded
    // stays 1, so the row genuinely has ZERO Blocks fields).
    const reseededId = await propertyUtils.seedDefaultBlocksField({
      databaseId,
      ownerEmail: OWNER,
      orgId: null,
      now,
    });
    await propertyUtils.repairUnseededBlocksFields();

    expect(await blocksDefinitions(databaseId)).toHaveLength(0);
    expect(reseededId).toBeNull();
  });
});

describe("writeBlockFieldContent — upsert race (finding 4)", () => {
  it("concurrent first-saves both succeed via onConflictDoUpdate", async () => {
    const { documentId } = await createDatabaseRow();
    const propertyId = `prop_${documentId}`;
    const now = new Date().toISOString();

    const results = await Promise.allSettled([
      propertyUtils.writeBlockFieldContent({
        documentId,
        propertyId,
        ownerEmail: OWNER,
        content: "first",
        now,
      }),
      propertyUtils.writeBlockFieldContent({
        documentId,
        propertyId,
        ownerEmail: OWNER,
        content: "second",
        now,
      }),
    ]);

    // No duplicate-key throw — both writes resolve.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(schema.documentBlockFieldContents.documentId, documentId),
          eq(schema.documentBlockFieldContents.propertyId, propertyId),
        ),
      );
    // Exactly one row (the unique index held); content is one of the two.
    expect(rows).toHaveLength(1);
    expect(["first", "second"]).toContain(rows[0].content);
  });

  it("a later write updates the existing row in place", async () => {
    const { documentId } = await createDatabaseRow();
    const propertyId = `prop2_${documentId}`;
    const now = new Date().toISOString();
    await propertyUtils.writeBlockFieldContent({
      documentId,
      propertyId,
      ownerEmail: OWNER,
      content: "v1",
      now,
    });
    await propertyUtils.writeBlockFieldContent({
      documentId,
      propertyId,
      ownerEmail: OWNER,
      content: "v2",
      now,
    });
    expect(
      await propertyUtils.readBlockFieldContent(documentId, propertyId),
    ).toBe("v2");
  });
});

describe("cascade cleanup of block-field content on delete (finding 7)", () => {
  it("deletes block-field rows by document id when a row document is deleted", async () => {
    const { databaseId } = await createDatabaseRow();
    const db = getDb();
    const now = new Date().toISOString();
    // A ROW document (a database item), distinct from the database PAGE doc —
    // this is the path delete-document deletes through.
    const rowDocumentId = `rowdoc_${databaseId}`;
    await db.insert(schema.documents).values({
      id: rowDocumentId,
      ownerEmail: OWNER,
      title: "Row",
      content: "",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: `item_cascade_${databaseId}`,
      ownerEmail: OWNER,
      databaseId,
      documentId: rowDocumentId,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    await propertyUtils.writeBlockFieldContent({
      documentId: rowDocumentId,
      propertyId: `prop_cascade_${rowDocumentId}`,
      ownerEmail: OWNER,
      content: "orphan-me",
      now,
    });

    await databaseUtils.deleteDatabaseDataForDocument(rowDocumentId, OWNER);

    const remaining = await db
      .select()
      .from(schema.documentBlockFieldContents)
      .where(eq(schema.documentBlockFieldContents.documentId, rowDocumentId));
    expect(remaining).toHaveLength(0);
  });

  it("deletes block-field rows by property id when a database is deleted", async () => {
    const { databaseId, documentId } = await createDatabaseRow();
    const db = getDb();
    const now = new Date().toISOString();
    const propertyId = `def_${databaseId}`;
    await db.insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail: OWNER,
      databaseId,
      name: "Notes",
      type: "blocks",
      visibility: "always_show",
      optionsJson: "{}",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    await propertyUtils.writeBlockFieldContent({
      documentId,
      propertyId,
      ownerEmail: OWNER,
      content: "orphan-me",
      now,
    });

    // documentId is the database PAGE document → hits the database-delete branch.
    await databaseUtils.deleteDatabaseDataForDocument(documentId, OWNER);

    const remaining = await db
      .select()
      .from(schema.documentBlockFieldContents)
      .where(eq(schema.documentBlockFieldContents.propertyId, propertyId));
    expect(remaining).toHaveLength(0);
  });
});

describe("primary Blocks value reflects the body, never the title (finding: word count)", () => {
  it("a row with a title but empty body resolves the primary Blocks value to '' (0 words / Empty)", async () => {
    const { databaseId } = await createDatabaseRow();
    const now = new Date().toISOString();
    await propertyUtils.seedDefaultBlocksField({
      databaseId,
      ownerEmail: OWNER,
      orgId: null,
      now,
    });

    // A brand-new row page: has a TITLE but an EMPTY body. The primary "Content"
    // Blocks field is backed by documents.content — it must NOT leak the title.
    const db = getDb();
    const rowDocumentId = `rowdoc_wc_${databaseId}`;
    await db.insert(schema.documents).values({
      id: rowDocumentId,
      ownerEmail: OWNER,
      parentId: `doc_${databaseId}`,
      title: "Test page",
      content: "",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: `item_wc_${databaseId}`,
      ownerEmail: OWNER,
      databaseId,
      documentId: rowDocumentId,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });

    const [rowDocument] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, rowDocumentId));
    const properties = await propertyUtils.listPropertiesForDatabase(
      databaseId,
      rowDocument,
    );
    const primary = properties.find(
      (p: any) =>
        p.definition.type === "blocks" &&
        isPrimaryBlocksField(p.definition.options),
    );

    // The primary Blocks value is the (empty) body, never the "Test page" title.
    expect(primary?.value).toBe("");
    expect(countWords(primary?.value)).toBe(0);
    expect(formatWordCount(primary?.value)).toBe("Empty");
    expect(primary?.value).not.toContain("Test");
  });

  it("typing N words in the body surfaces N words — still excluding the title", async () => {
    const { databaseId } = await createDatabaseRow();
    const now = new Date().toISOString();
    const primaryId = await propertyUtils.seedDefaultBlocksField({
      databaseId,
      ownerEmail: OWNER,
      orgId: null,
      now,
    });

    const db = getDb();
    const rowDocumentId = `rowdoc_wc2_${databaseId}`;
    await db.insert(schema.documents).values({
      id: rowDocumentId,
      ownerEmail: OWNER,
      parentId: `doc_${databaseId}`,
      title: "Five word title goes here",
      content: "",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: `item_wc2_${databaseId}`,
      ownerEmail: OWNER,
      databaseId,
      documentId: rowDocumentId,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Write three words to the body (primary → document body).
    // writePrimaryBlocksContent now asserts editor access on the document, so
    // run it in the owner's request context (assertAccess reads currentAccess()).
    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await propertyUtils.writePrimaryBlocksContent({
        documentId: rowDocumentId,
        content: "one two three",
        now,
      });
    });

    const [rowDocument] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, rowDocumentId));
    const properties = await propertyUtils.listPropertiesForDatabase(
      databaseId,
      rowDocument,
    );
    const primary = properties.find((p: any) => p.definition.id === primaryId);

    // Word count reflects ONLY the 3 body words — not the 5-word title.
    expect(primary?.value).toBe("one two three");
    expect(countWords(primary?.value)).toBe(3);
    expect(formatWordCount(primary?.value)).toBe("3 words");
  });
});

describe("rollups resolve Blocks fields from their backing stores", () => {
  it("rolls up primary Blocks values from linked document bodies", async () => {
    const { databaseId, documentId } = await createDatabaseRow();
    const now = new Date().toISOString();
    const primaryId = await propertyUtils.seedDefaultBlocksField({
      databaseId,
      ownerEmail: OWNER,
      orgId: null,
      now,
    });
    const db = getDb();
    const sourceDocumentId = `source_rollup_${databaseId}`;
    const targetDocumentId = `target_rollup_${databaseId}`;
    const relationPropertyId = `relation_${databaseId}`;
    const rollupPropertyId = `rollup_${databaseId}`;

    await db.insert(schema.documents).values([
      {
        id: sourceDocumentId,
        ownerEmail: OWNER,
        parentId: documentId,
        title: "Source",
        content: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: targetDocumentId,
        ownerEmail: OWNER,
        parentId: documentId,
        title: "Target",
        content: "target body",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.documentPropertyDefinitions).values([
      {
        id: relationPropertyId,
        ownerEmail: OWNER,
        databaseId,
        name: "Related",
        type: "relation",
        visibility: "always_show",
        optionsJson: JSON.stringify({ relation: { databaseId } }),
        position: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: rollupPropertyId,
        ownerEmail: OWNER,
        databaseId,
        name: "Related body",
        type: "rollup",
        visibility: "always_show",
        optionsJson: JSON.stringify({
          rollup: {
            relationPropertyId,
            targetPropertyId: primaryId,
            aggregation: "count_values",
          },
        }),
        position: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.documentPropertyValues).values({
      id: `value_${sourceDocumentId}`,
      ownerEmail: OWNER,
      documentId: sourceDocumentId,
      propertyId: relationPropertyId,
      valueJson: JSON.stringify([targetDocumentId]),
      createdAt: now,
      updatedAt: now,
    });

    const [sourceDocument] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, sourceDocumentId));
    const properties = await runWithRequestContext({ userEmail: OWNER }, () =>
      propertyUtils.listPropertiesForDatabase(databaseId, sourceDocument),
    );

    expect(
      properties.find(
        (property: any) => property.definition.id === rollupPropertyId,
      )?.value,
    ).toBe(1);
  });

  it("rolls up additional Blocks values from document_block_field_contents", async () => {
    const { databaseId, documentId } = await createDatabaseRow();
    const now = new Date().toISOString();
    const db = getDb();
    const sourceDocumentId = `source_extra_rollup_${databaseId}`;
    const targetDocumentId = `target_extra_rollup_${databaseId}`;
    const relationPropertyId = `relation_extra_${databaseId}`;
    const blocksPropertyId = `blocks_extra_${databaseId}`;
    const rollupPropertyId = `rollup_extra_${databaseId}`;

    await db.insert(schema.documents).values([
      {
        id: sourceDocumentId,
        ownerEmail: OWNER,
        parentId: documentId,
        title: "Source",
        content: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: targetDocumentId,
        ownerEmail: OWNER,
        parentId: documentId,
        title: "Target",
        content: "",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.documentPropertyDefinitions).values([
      {
        id: relationPropertyId,
        ownerEmail: OWNER,
        databaseId,
        name: "Related",
        type: "relation",
        visibility: "always_show",
        optionsJson: JSON.stringify({ relation: { databaseId } }),
        position: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: blocksPropertyId,
        ownerEmail: OWNER,
        databaseId,
        name: "Notes",
        type: "blocks",
        visibility: "always_show",
        optionsJson: JSON.stringify({ blocks: { primary: false } }),
        position: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: rollupPropertyId,
        ownerEmail: OWNER,
        databaseId,
        name: "Related notes",
        type: "rollup",
        visibility: "always_show",
        optionsJson: JSON.stringify({
          rollup: {
            relationPropertyId,
            targetPropertyId: blocksPropertyId,
            aggregation: "count_values",
          },
        }),
        position: 3,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.documentPropertyValues).values({
      id: `value_${sourceDocumentId}`,
      ownerEmail: OWNER,
      documentId: sourceDocumentId,
      propertyId: relationPropertyId,
      valueJson: JSON.stringify([targetDocumentId]),
      createdAt: now,
      updatedAt: now,
    });
    await propertyUtils.writeBlockFieldContent({
      documentId: targetDocumentId,
      propertyId: blocksPropertyId,
      ownerEmail: OWNER,
      content: "additional body",
      now,
    });

    const [sourceDocument] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, sourceDocumentId));
    const properties = await runWithRequestContext({ userEmail: OWNER }, () =>
      propertyUtils.listPropertiesForDatabase(databaseId, sourceDocument),
    );

    expect(
      properties.find(
        (property: any) => property.definition.id === rollupPropertyId,
      )?.value,
    ).toBe(1);
  });
});
