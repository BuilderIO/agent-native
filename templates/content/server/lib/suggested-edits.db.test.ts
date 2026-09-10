import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-suggested-edits-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");
type Adapter =
  typeof import("./suggested-edits.js").contentDocumentSuggestionAdapter;
type DbExec = import("@agent-native/core/db").DbExec;

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let getDbExec: typeof import("@agent-native/core/db").getDbExec;
let adapter: Adapter;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDbExec = (await import("@agent-native/core/db")).getDbExec;
  adapter = (await import("./suggested-edits.js"))
    .contentDocumentSuggestionAdapter;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

const ownerEmail = "owner@example.com";
let sequence = 0;

async function seedSystemDatabasePage() {
  sequence += 1;
  const suffix = `${sequence}`;
  const documentId = `suggestion-system-page-${suffix}`;
  const databaseDocumentId = `suggestion-system-db-page-${suffix}`;
  const databaseId = `suggestion-system-db-${suffix}`;
  const propertyId = `suggestion-primary-blocks-${suffix}`;
  const now = new Date().toISOString();
  const db = getDb();
  await db.insert(schema.documents).values([
    {
      id: databaseDocumentId,
      title: "Files",
      content: "",
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      title: "Page",
      content: "Before",
      ownerEmail,
      createdAt: now,
      updatedAt: "rev-1",
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail,
    documentId: databaseDocumentId,
    title: "Files",
    systemRole: "files",
    primaryBlocksPropertyId: propertyId,
    blocksSeeded: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail,
    databaseId,
    name: "Content",
    type: "blocks",
    optionsJson: JSON.stringify({ blocks: { primary: true } }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: `suggestion-system-item-${suffix}`,
    ownerEmail,
    databaseId,
    documentId,
    createdAt: now,
    updatedAt: now,
  });
  return { documentId, propertyId };
}

const operation = {
  ordinal: 0,
  kind: "replace_text",
  targetId: "body",
  before: { markdown: "Before" },
  after: { markdown: "After" },
  anchor: { from: 0, to: 6, prefix: "", suffix: "" },
  schemaVersion: 1,
} as const;

function coordination() {
  return {
    ydoc: {
      doc: new Y.Doc(),
      baseVersion: null,
      persist: vi.fn(async () => {}),
    },
    sync: {
      persist: vi.fn(async () => {}),
      isPersisted: () => true,
      publish: vi.fn(),
    },
  };
}

async function accept(documentId: string, tx: DbExec) {
  const prepared = coordination();
  await adapter.apply({
    resourceType: "document",
    resourceId: documentId,
    suggestion: {
      id: `suggestion-${documentId}`,
      revision: 1,
      resourceType: "document",
      resourceId: documentId,
      adapterKind: adapter.kind,
      adapterVersion: 1,
      threadId: `thread-${documentId}`,
      authorEmail: "commenter@example.com",
      actorKind: "human",
      baseRevision: "rev-1",
      status: "pending",
      summary: "Suggest edits",
      ownerEmail,
      orgId: null,
      visibility: "private",
      createdAt: "now",
      updatedAt: "now",
      metadata: null,
      operations: [operation],
    },
    operations: [operation],
    access: { role: "editor" },
    ctx: {},
    transaction: tx,
    coordination: prepared,
  });
  return prepared;
}

describe("Content suggested edits Blocks transaction", () => {
  it("accepts a system database Page and reconciles its primary Blocks identity", async () => {
    const { documentId, propertyId } = await seedSystemDatabasePage();
    let prepared!: ReturnType<typeof coordination>;
    await getDbExec().transaction!(async (tx) => {
      prepared = await accept(documentId, tx);
    });

    const db = getDb();
    const [document] = await db
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const [field] = await db
      .select()
      .from(schema.documentBlockFields)
      .where(eq(schema.documentBlockFields.propertyId, propertyId));
    const blocks = await db
      .select({ markdown: schema.documentBlocks.markdown })
      .from(schema.documentBlocks)
      .where(eq(schema.documentBlocks.fieldId, field!.id));

    expect(document?.content).toBe("After");
    expect(field).toMatchObject({ documentId, propertyId, revision: 1 });
    expect(blocks).toEqual([{ markdown: "After" }]);
    expect(yDocToProsemirrorJSON(prepared.ydoc.doc, "default")).toMatchObject({
      content: [{ type: "paragraph", content: [{ text: "After" }] }],
    });
  });

  it("rolls back canonical and Blocks identity writes when the acceptance transaction fails", async () => {
    const { documentId, propertyId } = await seedSystemDatabasePage();
    await expect(
      getDbExec().transaction!(async (tx) => {
        const failingTx: DbExec = {
          execute: async (statement) => {
            const sql =
              typeof statement === "string" ? statement : statement.sql;
            if (sql.startsWith("INSERT INTO document_versions")) {
              throw new Error("forced version failure");
            }
            return tx.execute(statement);
          },
        };
        await accept(documentId, failingTx);
      }),
    ).rejects.toThrow("forced version failure");

    const db = getDb();
    const [document] = await db
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const fields = await db
      .select()
      .from(schema.documentBlockFields)
      .where(eq(schema.documentBlockFields.propertyId, propertyId));
    expect(document?.content).toBe("Before");
    expect(fields).toEqual([]);
  });
});
