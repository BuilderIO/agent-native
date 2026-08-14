import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runFrameworkReleaseMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// guard:allow-unscoped — isolated SQLite fixtures intentionally inspect exact rows.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-block-actions-${process.pid}-${Date.now()}.sqlite`,
);
const TEST_DATABASE_URL =
  process.env.CONTENT_BLOCK_ACTION_POSTGRES_URL ?? `file:${TEST_DB_PATH}`;
const OWNER = "owner@example.com";
const OUTSIDER = "outsider@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let createRow: typeof import("./add-database-item.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let listBlocks: typeof import("./list-content-database-blocks.js").default;
let mutateBlock: typeof import("./mutate-content-database-block.js").default;
let compareAndSwapAdditionalBlocksField: typeof import("./_database-block-actions.js").compareAndSwapAdditionalBlocksField;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);

beforeAll(async () => {
  if (TEST_DATABASE_URL.startsWith("postgres")) {
    const databaseName = new URL(TEST_DATABASE_URL).pathname.toLowerCase();
    if (!databaseName.includes("test")) {
      throw new Error(
        "CONTENT_BLOCK_ACTION_POSTGRES_URL must name an isolated test database.",
      );
    }
  }
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createDatabase = (await import("./create-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  getDatabase = (await import("./get-content-database.js")).default;
  createRow = (await import("./add-database-item.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  listBlocks = (await import("./list-content-database-blocks.js")).default;
  mutateBlock = (await import("./mutate-content-database-block.js")).default;
  compareAndSwapAdditionalBlocksField = (
    await import("./_database-block-actions.js")
  ).compareAndSwapAdditionalBlocksField;
  if (TEST_DATABASE_URL.startsWith("postgres")) {
    await runFrameworkReleaseMigrations(undefined);
  }
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  if (!TEST_DATABASE_URL.startsWith("file:")) return;
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function fixture(initialMarkdown = "Alpha\nBeta\nGamma") {
  const created = await asOwner(() =>
    createDatabase.run({ title: "Block action fixture" }),
  );
  const databaseId = created.database.id;
  const databaseDocumentId = created.database.documentId;
  const initial = await asOwner(() => getDatabase.run({ databaseId }));
  if (!("database" in initial) || !initial.mutationContract) {
    throw new Error("Fixture database has no mutation contract.");
  }
  const primary = initial.mutationContract.properties.find(
    (property) => property.type === "blocks",
  );
  if (!primary) throw new Error("Fixture database has no Blocks property.");
  const row = await asOwner(() =>
    createRow.run({
      target: initial.mutationContract!.target,
      expectedSchemaRevision: initial.mutationContract!.schemaRevision,
      idempotencyKey: `create-row-${databaseId}`,
      title: "Fixture row",
    }),
  );
  await asOwner(() =>
    setProperty.run({
      databaseId,
      documentId: row.receipt.row.documentId,
      propertyId: primary.id,
      value: initialMarkdown,
      expectedBlocksFieldRevision: 0,
    }),
  );
  const current = await asOwner(() => getDatabase.run({ databaseId }));
  if (!("database" in current) || !current.mutationContract) {
    throw new Error("Fixture database disappeared.");
  }
  const target = {
    ...current.mutationContract.target,
    itemId: row.receipt.row.itemId,
    rowDocumentId: row.receipt.row.documentId,
    propertyId: primary.id,
  };
  const listed = await asOwner(() => listBlocks.run({ target, limit: 100 }));
  return { databaseId, databaseDocumentId, target, listed };
}

function envelope(
  fixture: Awaited<ReturnType<typeof fixture>>,
  idempotencyKey: string,
) {
  return {
    target: fixture.target,
    expectedSchemaRevision: fixture.listed.schemaRevision,
    expectedRowRevision: fixture.listed.rowRevision,
    expectedFieldRevision: fixture.listed.fieldRevision,
    idempotencyKey,
  };
}

describe("exact Content database block actions", () => {
  it("lists revision-pinned pages and performs every supported operation with verified retry receipts", async () => {
    const state = await fixture();
    const [alpha, beta, gamma] = state.listed.blocks;
    expect(state.listed).toMatchObject({
      total: 3,
      identityStatus: "materialized",
      rowLink: { urlPath: `/page/${state.target.rowDocumentId}` },
    });
    const firstPage = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 1 }),
    );
    expect(firstPage.page.nextCursor).toBeTruthy();

    const insertInput = {
      ...envelope(state, "insert-middle"),
      operation: "insert" as const,
      block: { kind: "paragraph" as const, nfm: "Middle" },
      position: { placement: "before" as const, anchorBlockId: beta!.id },
    };
    const inserted = await asOwner(() => mutateBlock.run(insertInput));
    const insertedId = inserted.receipt.affected.blockIds.find(
      (id) => !state.listed.order.includes(id),
    );
    expect(insertedId).toBeTruthy();
    expect(inserted.receipt).toMatchObject({
      operation: "insert",
      outcome: "inserted",
      idempotency: { key: "insert-middle", result: "applied" },
      readback: { verified: true },
    });
    expect(inserted.receipt.affected.order).toEqual([
      alpha!.id,
      insertedId,
      beta!.id,
      gamma!.id,
    ]);

    const replayed = await asOwner(() => mutateBlock.run(insertInput));
    expect(replayed.receipt.receiptId).toBe(inserted.receipt.receiptId);
    expect(replayed.receipt.idempotency.result).toBe("replayed");
    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...insertInput,
          block: { kind: "paragraph", nfm: "Different payload" },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      asOwner(() =>
        listBlocks.run({
          target: state.target,
          limit: 1,
          cursor: firstPage.page.nextCursor!,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "FIELD_REVISION_CONFLICT" });

    let current = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    const updated = await asOwner(() =>
      mutateBlock.run({
        target: state.target,
        expectedSchemaRevision: current.schemaRevision,
        expectedRowRevision: current.rowRevision,
        expectedFieldRevision: current.fieldRevision,
        idempotencyKey: "update-inserted",
        operation: "update",
        blockId: insertedId!,
        block: { kind: "paragraph", nfm: "Middle updated" },
      }),
    );
    expect(
      updated.receipt.readback.blocks.find((block) => block.id === insertedId)
        ?.value.nfm,
    ).toBe("Middle updated");

    current = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    const reordered = await asOwner(() =>
      mutateBlock.run({
        target: state.target,
        expectedSchemaRevision: current.schemaRevision,
        expectedRowRevision: current.rowRevision,
        expectedFieldRevision: current.fieldRevision,
        idempotencyKey: "reorder-inserted",
        operation: "reorder",
        blockId: insertedId!,
        position: { placement: "after", anchorBlockId: gamma!.id },
      }),
    );
    expect(reordered.receipt.affected.order.at(-1)).toBe(insertedId);

    current = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    const existingUpsert = await asOwner(() =>
      mutateBlock.run({
        target: state.target,
        expectedSchemaRevision: current.schemaRevision,
        expectedRowRevision: current.rowRevision,
        expectedFieldRevision: current.fieldRevision,
        idempotencyKey: "upsert-existing",
        operation: "upsert",
        blockId: beta!.id,
        block: { kind: "paragraph", nfm: "Beta upserted" },
      }),
    );
    expect(existingUpsert.receipt.affected.blockIds).toContain(beta!.id);

    current = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    const requestedId = `block_requested_${Date.now()}`;
    const insertedUpsert = await asOwner(() =>
      mutateBlock.run({
        target: state.target,
        expectedSchemaRevision: current.schemaRevision,
        expectedRowRevision: current.rowRevision,
        expectedFieldRevision: current.fieldRevision,
        idempotencyKey: "upsert-new",
        operation: "upsert",
        blockId: requestedId,
        block: { kind: "paragraph", nfm: "Caller ID" },
        position: { placement: "start" },
      }),
    );
    expect(insertedUpsert.receipt.affected.order[0]).toBe(requestedId);
    expect(insertedUpsert.receipt.outcome).toBe("inserted");

    current = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    const deleted = await asOwner(() =>
      mutateBlock.run({
        target: state.target,
        expectedSchemaRevision: current.schemaRevision,
        expectedRowRevision: current.rowRevision,
        expectedFieldRevision: current.fieldRevision,
        idempotencyKey: "delete-alpha",
        operation: "delete",
        blockId: alpha!.id,
      }),
    );
    expect(deleted.receipt.affected.deletedBlockIds).toContain(alpha!.id);
    current = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    await asOwner(() =>
      mutateBlock.run({
        target: state.target,
        expectedSchemaRevision: current.schemaRevision,
        expectedRowRevision: current.rowRevision,
        expectedFieldRevision: current.fieldRevision,
        idempotencyKey: "insert-identical-to-tombstone",
        operation: "insert",
        block: { kind: "paragraph", nfm: "Alpha" },
        position: { placement: "start" },
      }),
    );
    current = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    await expect(
      asOwner(() =>
        mutateBlock.run({
          target: state.target,
          expectedSchemaRevision: current.schemaRevision,
          expectedRowRevision: current.rowRevision,
          expectedFieldRevision: current.fieldRevision,
          idempotencyKey: "restore-tombstone",
          operation: "upsert",
          blockId: alpha!.id,
          block: { kind: "paragraph", nfm: "Not a restore" },
          position: { placement: "start" },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "BLOCK_ID_TOMBSTONED" });

    const lateReplay = await asOwner(() => mutateBlock.run(insertInput));
    expect(lateReplay.receipt.receiptId).toBe(inserted.receipt.receiptId);
    expect(lateReplay.receipt.idempotency.result).toBe("replayed");
  });

  it("rejects stale row, field, schema, target, access, and unsupported operations without clobbering", async () => {
    const state = await fixture("- one\n- two\n\nSibling");
    const listItem = state.listed.blocks.find(
      (block) => block.kind === "listItem",
    )!;
    const before = state.listed.order;
    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "unsupported-list-update"),
          operation: "update",
          blockId: listItem.id,
          block: { kind: "listItem", nfm: "- changed" },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "BLOCK_OPERATION_UNSUPPORTED" });
    const unchanged = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    expect(unchanged.order).toEqual(before);
    expect(unchanged.fieldRevision).toBe(state.listed.fieldRevision);

    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "stale-row"),
          expectedRowRevision: "sha256:stale",
          operation: "delete",
          blockId: listItem.id,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "ROW_REVISION_CONFLICT" });
    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "stale-field"),
          expectedFieldRevision: state.listed.fieldRevision + 1,
          operation: "delete",
          blockId: listItem.id,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "FIELD_REVISION_CONFLICT" });
    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "wrong-target"),
          target: { ...state.target, spaceId: "wrong-space" },
          operation: "delete",
          blockId: listItem.id,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "TARGET_MISMATCH" });
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        listBlocks.run({ target: state.target, limit: 100 }),
      ),
    ).rejects.toThrow();

    await asOwner(() =>
      configureProperty.run({
        documentId: state.databaseDocumentId,
        databaseId: state.databaseId,
        name: "Schema drift",
        type: "text",
      }),
    );
    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "stale-schema"),
          operation: "delete",
          blockId: listItem.id,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "SCHEMA_REVISION_CONFLICT" });
  });

  it("mutates an additional Blocks property without changing the primary field or another property", async () => {
    const state = await fixture("Primary stays");
    const added = await asOwner(() =>
      configureProperty.run({
        documentId: state.databaseDocumentId,
        databaseId: state.databaseId,
        name: "Research notes",
        type: "blocks",
      }),
    );
    const additional = added.properties.find(
      (property) => property.definition.name === "Research notes",
    )!;
    await asOwner(() =>
      setProperty.run({
        databaseId: state.databaseId,
        documentId: state.target.rowDocumentId,
        propertyId: additional.definition.id,
        value: "Notes A\nNotes B",
        expectedBlocksFieldRevision: 0,
      }),
    );
    const discovered = await asOwner(() =>
      getDatabase.run({ databaseId: state.databaseId }),
    );
    if (!("database" in discovered) || !discovered.mutationContract) {
      throw new Error("Fixture database disappeared.");
    }
    const additionalTarget = {
      ...discovered.mutationContract.target,
      itemId: state.target.itemId,
      rowDocumentId: state.target.rowDocumentId,
      propertyId: additional.definition.id,
    };
    const additionalBefore = await asOwner(() =>
      listBlocks.run({ target: additionalTarget, limit: 100 }),
    );
    await asOwner(() =>
      mutateBlock.run({
        target: additionalTarget,
        expectedSchemaRevision: additionalBefore.schemaRevision,
        expectedRowRevision: additionalBefore.rowRevision,
        expectedFieldRevision: additionalBefore.fieldRevision,
        idempotencyKey: "additional-update",
        operation: "update",
        blockId: additionalBefore.blocks[0]!.id,
        block: { kind: "paragraph", nfm: "Notes A changed" },
      }),
    );
    const primaryAfter = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    expect(primaryAfter.blocks.map((block) => block.value.nfm)).toEqual([
      "Primary stays",
    ]);
    const [storedAdditional] = await getDb()
      .select({ content: schema.documentBlockFieldContents.content })
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(
            schema.documentBlockFieldContents.documentId,
            state.target.rowDocumentId,
          ),
          eq(
            schema.documentBlockFieldContents.propertyId,
            additional.definition.id,
          ),
        ),
      );
    expect(storedAdditional?.content).toBe("Notes A changed\nNotes B");
  });

  it("rejects a direct editor-body race without overwriting the newer body", async () => {
    const state = await fixture("Before\nSibling");
    await getDb()
      .update(schema.documents)
      .set({ content: "Editor won\nSibling" })
      .where(eq(schema.documents.id, state.target.rowDocumentId));

    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "editor-race"),
          operation: "update",
          blockId: state.listed.blocks[0]!.id,
          block: { kind: "paragraph", nfm: "Agent write" },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "BLOCK_IDENTITY_STALE" });

    const [stored] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, state.target.rowDocumentId));
    expect(stored?.content).toBe("Editor won\nSibling");
  });

  it("rejects stale existing and absent additional-field writes without clobbering", async () => {
    const state = await fixture("Primary stays");
    const added = await asOwner(() =>
      configureProperty.run({
        documentId: state.databaseDocumentId,
        databaseId: state.databaseId,
        name: "Concurrent notes",
        type: "blocks",
      }),
    );
    const additional = added.properties.find(
      (property) => property.definition.name === "Concurrent notes",
    )!;
    await asOwner(() =>
      setProperty.run({
        databaseId: state.databaseId,
        documentId: state.target.rowDocumentId,
        propertyId: additional.definition.id,
        value: "Agent read this\nSibling",
        expectedBlocksFieldRevision: 0,
      }),
    );

    await getDb()
      .update(schema.documentBlockFieldContents)
      .set({ content: "UI won\nSibling" })
      .where(
        and(
          eq(
            schema.documentBlockFieldContents.documentId,
            state.target.rowDocumentId,
          ),
          eq(
            schema.documentBlockFieldContents.propertyId,
            additional.definition.id,
          ),
        ),
      );

    await expect(
      compareAndSwapAdditionalBlocksField({
        db: getDb(),
        ownerEmail: OWNER,
        documentId: state.target.rowDocumentId,
        propertyId: additional.definition.id,
        expectedContent: "Agent read this\nSibling",
        expectedExists: true,
        content: "Agent write\nSibling",
        now: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ errorCode: "FIELD_REVISION_CONFLICT" });

    const [stored] = await getDb()
      .select({ content: schema.documentBlockFieldContents.content })
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(
            schema.documentBlockFieldContents.documentId,
            state.target.rowDocumentId,
          ),
          eq(
            schema.documentBlockFieldContents.propertyId,
            additional.definition.id,
          ),
        ),
      );
    expect(stored?.content).toBe("UI won\nSibling");

    const addedAbsent = await asOwner(() =>
      configureProperty.run({
        documentId: state.databaseDocumentId,
        databaseId: state.databaseId,
        name: "Concurrent insert",
        type: "blocks",
      }),
    );
    const absent = addedAbsent.properties.find(
      (property) => property.definition.name === "Concurrent insert",
    )!;
    await asOwner(() =>
      setProperty.run({
        databaseId: state.databaseId,
        documentId: state.target.rowDocumentId,
        propertyId: absent.definition.id,
        value: "UI created this",
        expectedBlocksFieldRevision: 0,
      }),
    );

    await expect(
      compareAndSwapAdditionalBlocksField({
        db: getDb(),
        ownerEmail: OWNER,
        documentId: state.target.rowDocumentId,
        propertyId: absent.definition.id,
        expectedContent: "",
        expectedExists: false,
        content: "Agent insert",
        now: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ errorCode: "FIELD_REVISION_CONFLICT" });

    const [insertedByUi] = await getDb()
      .select({ content: schema.documentBlockFieldContents.content })
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(
            schema.documentBlockFieldContents.documentId,
            state.target.rowDocumentId,
          ),
          eq(
            schema.documentBlockFieldContents.propertyId,
            absent.definition.id,
          ),
        ),
      );
    expect(insertedByUi?.content).toBe("UI created this");
  });
});
