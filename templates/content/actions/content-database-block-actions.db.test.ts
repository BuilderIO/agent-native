import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withMigrationRuntime } from "@agent-native/core/db";
import {
  privateMedia,
  privateMediaStore,
} from "@agent-native/core/private-media";
import {
  runFrameworkReleaseMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { knownLossTest } from "../acceptance/known-loss";

const NESTED_TRANSACTION_LOSS = {
  lane: "unowned",
  reason:
    "The test starts mutate-content-database-block inside the title edit's transaction callback, so core refuses the action's root transaction (Cannot start a root transaction while another transaction is active) before it reaches the ROW_REVISION_CONFLICT check.",
} as const;

// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect exact rows.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-block-actions-${process.pid}-${Date.now()}.pglite`,
);
const TEST_DATABASE_URL =
  process.env.CONTENT_BLOCK_ACTION_POSTGRES_URL ?? `pglite:${TEST_DB_PATH}`;
const OUTSIDER = "outsider@example.com";
let ownerSequence = 0;
let ownerEmail = "block-owner-0@example.com";

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
let persistBlocksFieldIdentity: typeof import("./_blocks-field-identity.js").persistBlocksFieldIdentity;
let putPageOnLiveCopy: typeof import("../server/test-support/live-copy-page.js").putPageOnLiveCopy;
let liveCopyVersionOf: typeof import("../server/test-support/live-copy-page.js").liveCopyVersionOf;
let turnLiveCopyFlagsOff: typeof import("../server/test-support/live-copy-page.js").turnLiveCopyFlagsOff;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: ownerEmail }, run);

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("Missing fixture value.");
  return value;
}

beforeEach(() => {
  ownerEmail = `block-owner-${++ownerSequence}@example.com`;
});

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
  persistBlocksFieldIdentity = (await import("./_blocks-field-identity.js"))
    .persistBlocksFieldIdentity;
  ({ putPageOnLiveCopy, liveCopyVersionOf, turnLiveCopyFlagsOff } =
    await import("../server/test-support/live-copy-page.js"));
  if (TEST_DATABASE_URL.startsWith("postgres")) {
    await withMigrationRuntime(() => runFrameworkReleaseMigrations(undefined));
  }
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await privateMediaStore.ready();
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
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

async function rowBodyState(documentId: string) {
  const [page] = await getDb()
    .select({
      content: schema.documents.content,
      bodyRevision: schema.documents.bodyRevision,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  const history = await getDb()
    .select({ id: schema.documentVersions.id })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId));
  return {
    ...page,
    liveCopyVersion: await liveCopyVersionOf(documentId),
    history: history.length,
  };
}

describe("exact Content database block actions", () => {
  it("rejects cross-field remapping of an action-preferred block ID", async () => {
    const target = await fixture("Target");
    const owner = await fixture("Owner");
    const requestedId = owner.listed.blocks[0]!.id;

    await expect(
      persistBlocksFieldIdentity({
        db: getDb(),
        ownerEmail,
        documentId: target.target.rowDocumentId,
        propertyId: target.target.propertyId,
        previousMarkdown: "Target",
        markdown: "Target\nInserted",
        expectedRevision: target.listed.fieldRevision,
        preferredIdsByPath: {
          "0": target.listed.blocks[0]!.id,
          "1": requestedId,
        },
        rejectCrossFieldIdRemapping: true,
        now: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({
      name: "BlocksFieldIdCollisionError",
      blockId: requestedId,
    });
  });

  it.each([false, true])(
    "performs every block operation with verified retry receipts (live copy: %s)",
    async (liveCopy) => {
      const state = await fixture();
      if (liveCopy)
        await putPageOnLiveCopy(state.target.rowDocumentId, { seeded: true });
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
        position: {
          placement: "before" as const,
          anchorBlockId: required(beta).id,
        },
      };
      const attempts = await Promise.all([
        asOwner(() => mutateBlock.run(insertInput)),
        asOwner(() => mutateBlock.run(insertInput)),
      ]);
      // oracle-change: PostgreSQL may lock either request first; exactly one must apply and the other must replay it.
      expect(
        attempts.map((attempt) => attempt.receipt.idempotency.result).sort(),
      ).toEqual(["applied", "replayed"]);
      const inserted = required(
        attempts.find(
          (attempt) => attempt.receipt.idempotency.result === "applied",
        ),
      );
      const concurrentRetry = required(
        attempts.find(
          (attempt) => attempt.receipt.idempotency.result === "replayed",
        ),
      );
      expect(concurrentRetry.receipt.receiptId).toBe(
        inserted.receipt.receiptId,
      );
      expect(concurrentRetry.receipt.idempotency.result).toBe("replayed");
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
        required(alpha).id,
        insertedId,
        required(beta).id,
        required(gamma).id,
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
            cursor: required(firstPage.page.nextCursor),
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
          blockId: required(insertedId),
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
          blockId: required(insertedId),
          position: { placement: "after", anchorBlockId: required(gamma).id },
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
          blockId: required(beta).id,
          block: { kind: "paragraph", nfm: "Beta upserted" },
          position: { placement: "start" },
        }),
      );
      expect(existingUpsert.receipt.affected.blockIds).toContain(
        required(beta).id,
      );
      expect(existingUpsert.receipt.affected.order[0]).toBe(required(beta).id);

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
          blockId: required(alpha).id,
        }),
      );
      expect(deleted.receipt.affected.deletedBlockIds).toContain(
        required(alpha).id,
      );
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
            blockId: required(alpha).id,
            block: { kind: "paragraph", nfm: "Not a restore" },
            position: { placement: "start" },
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "BLOCK_ID_TOMBSTONED" });

      await expect(
        asOwner(() => mutateBlock.run(insertInput)),
      ).rejects.toMatchObject({
        errorCode: "IDEMPOTENCY_REPLAY_DRIFT",
        details: { receiptId: inserted.receipt.receiptId },
      });
      expect(
        await asOwner(() =>
          listBlocks.run({ target: state.target, limit: 100 }),
        ),
      ).toEqual(current);
    },
  );

  it.each([false, true])(
    "keeps every primary identity current across databases (live copy: %s)",
    async (liveCopy) => {
      const first = await fixture("Alpha\nBeta");
      const secondCreated = await asOwner(() =>
        createDatabase.run({ title: "Second primary identity" }),
      );
      const secondDatabaseId = secondCreated.database.id;
      const secondRead = await asOwner(() =>
        getDatabase.run({ databaseId: secondDatabaseId }),
      );
      if (!("database" in secondRead) || !secondRead.mutationContract) {
        throw new Error("Second fixture database has no mutation contract.");
      }
      const secondPrimary = secondRead.mutationContract.properties.find(
        (property) => property.type === "blocks",
      );
      if (!secondPrimary)
        throw new Error("Second fixture has no Blocks property.");
      const now = new Date().toISOString();
      const secondItemId = `shared-item-${Date.now()}`;
      await getDb().insert(schema.contentDatabaseItems).values({
        id: secondItemId,
        ownerEmail,
        orgId: secondRead.database.orgId,
        databaseId: secondDatabaseId,
        documentId: first.target.rowDocumentId,
        position: 0,
        createdAt: now,
        updatedAt: now,
      });
      const secondTarget = {
        ...secondRead.mutationContract.target,
        itemId: secondItemId,
        rowDocumentId: first.target.rowDocumentId,
        propertyId: secondPrimary.id,
      };
      await asOwner(() =>
        setProperty.run({
          databaseId: secondDatabaseId,
          documentId: first.target.rowDocumentId,
          propertyId: secondPrimary.id,
          value: "Alpha\nBeta",
          expectedBlocksFieldRevision: 0,
        }),
      );
      if (liveCopy)
        await putPageOnLiveCopy(first.target.rowDocumentId, { seeded: true });
      const firstBefore = await asOwner(() =>
        listBlocks.run({ target: first.target, limit: 100 }),
      );
      const secondBefore = await asOwner(() =>
        listBlocks.run({ target: secondTarget, limit: 100 }),
      );

      await asOwner(() =>
        mutateBlock.run({
          target: first.target,
          expectedSchemaRevision: firstBefore.schemaRevision,
          expectedRowRevision: firstBefore.rowRevision,
          expectedFieldRevision: firstBefore.fieldRevision,
          idempotencyKey: "multi-primary-update",
          operation: "update",
          blockId: required(firstBefore.blocks[0]).id,
          block: { kind: "paragraph", nfm: "Alpha updated" },
        }),
      );

      const secondAfter = await asOwner(() =>
        listBlocks.run({ target: secondTarget, limit: 100 }),
      );
      expect(secondAfter.identityStatus).toBe("materialized");
      expect(secondAfter.fieldRevision).toBe(secondBefore.fieldRevision + 1);
      expect(secondAfter.blocks.map((block) => block.value.nfm)).toEqual([
        "Alpha updated",
        "Beta",
      ]);
      expect(secondAfter.order).toEqual(secondBefore.order);
    },
  );

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

    const sibling = state.listed.blocks.find(
      (block) => block.kind === "paragraph",
    )!;
    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "leaf-parent"),
          operation: "insert",
          block: { kind: "paragraph", nfm: "Nested" },
          position: { placement: "end", parentBlockId: sibling.id },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "INVALID_BLOCK_VALUE" });
    const afterLeafRejection = await asOwner(() =>
      listBlocks.run({ target: state.target, limit: 100 }),
    );
    expect(afterLeafRejection.order).toEqual(before);
    expect(afterLeafRejection.fieldRevision).toBe(state.listed.fieldRevision);

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
    await putPageOnLiveCopy(state.target.rowDocumentId, { seeded: true });
    const primaryBefore = await rowBodyState(state.target.rowDocumentId);
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
    expect(await rowBodyState(state.target.rowDocumentId)).toEqual(
      primaryBefore,
    );
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

  it("refuses inserting a copy of a video with its id", async () => {
    const video =
      '<video src="https://example.com/a.mp4" id="video-original"></video>';
    const state = await fixture(`Alpha\n${video}`);
    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "video-copy"),
          operation: "insert",
          block: { kind: "video", nfm: video },
          position: { placement: "end" },
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_VIDEO_ID_SHARED",
      details: { blockId: "video-original" },
    });
    const [stored] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, state.target.rowDocumentId));
    expect(stored?.content).toBe(`Alpha\n${video}`);
  });

  it("binds a private image that a primary block mutation adds", async () => {
    const state = await fixture("Before\nSibling");
    const mediaId = "7b0e8c52-4f8a-4d1e-9c3a-2f6d5e4b3a21";
    await getDb().insert(privateMedia).values({
      id: mediaId,
      ownerEmail,
      mimeType: "image/png",
      size: 3,
      sha256: "0",
      blobHandleJson: "{}",
      createdAt: 0,
    });

    await asOwner(() =>
      mutateBlock.run({
        ...envelope(state, "private-image"),
        operation: "update",
        blockId: state.listed.blocks[0].id,
        block: {
          kind: "paragraph",
          nfm: `See the [photo](/api/private-media/${mediaId}).`,
        },
      }),
    );

    const bound = await getDb()
      .select()
      .from(schema.privateMediaReferences)
      .where(
        and(
          eq(
            schema.privateMediaReferences.documentId,
            state.target.rowDocumentId,
          ),
          eq(schema.privateMediaReferences.mediaId, mediaId),
        ),
      );
    expect(bound).toHaveLength(1);
  });

  it("binds private images that Blocks fields and Files & media values add", async () => {
    const state = await fixture("Primary");
    const [inSetField, inMutation, inFiles, inBody] = [
      "7b0e8c52-4f8a-4d1e-9c3a-2f6d5e4b3a31",
      "7b0e8c52-4f8a-4d1e-9c3a-2f6d5e4b3a32",
      "7b0e8c52-4f8a-4d1e-9c3a-2f6d5e4b3a33",
      "7b0e8c52-4f8a-4d1e-9c3a-2f6d5e4b3a34",
    ];
    for (const id of [inSetField, inMutation, inFiles, inBody]) {
      await getDb().insert(privateMedia).values({
        id,
        ownerEmail,
        mimeType: "image/png",
        size: 3,
        sha256: "0",
        blobHandleJson: "{}",
        createdAt: 0,
      });
    }
    const addProperty = async (
      name: string,
      type: "blocks" | "files_media",
    ) => {
      const added = await asOwner(() =>
        configureProperty.run({
          documentId: state.databaseDocumentId,
          databaseId: state.databaseId,
          name,
          type,
        }),
      );
      const property = added.properties.find(
        (candidate) => candidate.definition.name === name,
      );
      if (!property) throw new Error(`Property "${name}" was not added.`);
      return property;
    };
    const notes = await addProperty("Image notes", "blocks");
    const files = await addProperty("Attachments", "files_media");

    await asOwner(() =>
      setProperty.run({
        databaseId: state.databaseId,
        documentId: state.target.rowDocumentId,
        propertyId: notes.definition.id,
        value: `![](/api/private-media/${inSetField})`,
        expectedBlocksFieldRevision: 0,
      }),
    );
    await asOwner(() =>
      setProperty.run({
        databaseId: state.databaseId,
        documentId: state.target.rowDocumentId,
        propertyId: files.definition.id,
        value: [`/api/private-media/${inFiles}`],
      }),
    );
    await asOwner(() =>
      setProperty.run({
        databaseId: state.databaseId,
        documentId: state.target.rowDocumentId,
        propertyId: state.target.propertyId,
        value: `![](/api/private-media/${inBody})`,
        expectedBlocksFieldRevision: state.listed.fieldRevision,
      }),
    );
    const discovered = await asOwner(() =>
      getDatabase.run({ databaseId: state.databaseId }),
    );
    if (!("database" in discovered) || !discovered.mutationContract) {
      throw new Error("Fixture database disappeared.");
    }
    const notesTarget = {
      ...discovered.mutationContract.target,
      itemId: state.target.itemId,
      rowDocumentId: state.target.rowDocumentId,
      propertyId: notes.definition.id,
    };
    const before = await asOwner(() =>
      listBlocks.run({ target: notesTarget, limit: 100 }),
    );
    await asOwner(() =>
      mutateBlock.run({
        target: notesTarget,
        expectedSchemaRevision: before.schemaRevision,
        expectedRowRevision: before.rowRevision,
        expectedFieldRevision: before.fieldRevision,
        idempotencyKey: "additional-private-image",
        operation: "insert",
        block: {
          kind: "paragraph",
          nfm: `See the [photo](/api/private-media/${inMutation}).`,
        },
        position: { placement: "end" },
      }),
    );

    const bound = await getDb()
      .select({ mediaId: schema.privateMediaReferences.mediaId })
      .from(schema.privateMediaReferences)
      .where(
        eq(
          schema.privateMediaReferences.documentId,
          state.target.rowDocumentId,
        ),
      );
    expect(bound.map((row) => row.mediaId).sort()).toEqual(
      [inSetField, inMutation, inFiles, inBody].sort(),
    );
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

  it(
    "serializes a direct title edit before validating the expected row revision",
    knownLossTest(NESTED_TRANSACTION_LOSS),
    async () => {
      const state = await fixture("Before\nSibling");
      let mutation!: Promise<unknown>;
      await getDb().transaction(async (tx: any) => {
        await tx
          .update(schema.documents)
          .set({ title: "UI title won", updatedAt: new Date().toISOString() })
          .where(eq(schema.documents.id, state.target.rowDocumentId));
        mutation = asOwner(() =>
          mutateBlock.run({
            ...envelope(state, "title-race"),
            operation: "update",
            blockId: state.listed.blocks[0]!.id,
            block: { kind: "paragraph", nfm: "Agent write" },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      await expect(mutation).rejects.toMatchObject({
        errorCode: "ROW_REVISION_CONFLICT",
      });
      const after = await asOwner(() =>
        listBlocks.run({ target: state.target, limit: 100 }),
      );
      expect(after.blocks.map((block) => block.value.nfm)).toEqual([
        "Before",
        "Sibling",
      ]);
      const [document] = await getDb()
        .select({ title: schema.documents.title })
        .from(schema.documents)
        .where(eq(schema.documents.id, state.target.rowDocumentId));
      expect(document?.title).toBe("UI title won");
    },
  );

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
        ownerEmail,
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
        ownerEmail,
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

  it("keeps an unchanged live block mutation from moving the row and refuses a stale field revision", async () => {
    const state = await fixture("Alpha\nBeta");
    await putPageOnLiveCopy(state.target.rowDocumentId, { seeded: true });
    const page = () =>
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, state.target.rowDocumentId));
    const before = await page();
    const liveBefore = await rowBodyState(state.target.rowDocumentId);
    const input = {
      ...envelope(state, "unchanged-live-block"),
      operation: "update" as const,
      blockId: state.listed.order[0],
      block: { kind: "paragraph" as const, nfm: "Alpha" },
    };
    const result = await asOwner(() => mutateBlock.run(input));
    expect(result.receipt.outcome).toBe("unchanged");
    expect(result.receipt.revisions.field).toEqual({
      before: state.listed.fieldRevision,
      after: state.listed.fieldRevision,
    });
    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...input,
          idempotencyKey: "stale-unchanged-live-block",
          expectedFieldRevision: state.listed.fieldRevision + 1,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "FIELD_REVISION_CONFLICT" });
    expect(await page()).toEqual(before);
    expect(await rowBodyState(state.target.rowDocumentId)).toEqual(liveBefore);
  });

  it.each([false, true])(
    "reorders identical siblings by ID exactly once (live copy: %s)",
    async (liveCopy) => {
      const state = await fixture("Same\nSame\nTail");
      const { getState } = await import("@agent-native/core/collab");
      await getState(state.target.rowDocumentId);
      if (liveCopy)
        await putPageOnLiveCopy(state.target.rowDocumentId, { seeded: true });
      const before = await rowBodyState(state.target.rowDocumentId);
      const [first, second, tail] = state.listed.order;
      const input = {
        ...envelope(state, "identical-reorder"),
        operation: "reorder" as const,
        blockId: second,
        position: { placement: "before" as const, anchorBlockId: first },
      };
      const result = await asOwner(() => mutateBlock.run(input));
      expect(result.receipt.outcome).toBe("reordered");
      expect(result.receipt.readback.order).toEqual([second, first, tail]);
      expect(result.receipt.revisions.field).toEqual({
        before: state.listed.fieldRevision,
        after: state.listed.fieldRevision + 1,
      });
      const replay = await asOwner(() => mutateBlock.run(input));
      expect(replay.receipt).toEqual({
        ...result.receipt,
        idempotency: { ...result.receipt.idempotency, result: "replayed" },
      });
      await expect(
        asOwner(() =>
          mutateBlock.run({
            ...input,
            idempotencyKey: "stale-after-identical-reorder",
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "FIELD_REVISION_CONFLICT" });
      expect(await rowBodyState(state.target.rowDocumentId)).toEqual(before);
      const current = await asOwner(() =>
        listBlocks.run({ target: state.target, limit: 100 }),
      );
      expect(current.order).toEqual([second, first, tail]);
      expect(current.fieldRevision).toBe(state.listed.fieldRevision + 1);
    },
  );

  it.each([false, true])(
    "refuses an overtaking title edit before a live block commit (changed: %s)",
    async (changed) => {
      const state = await fixture("Alpha\nBeta");
      await putPageOnLiveCopy(state.target.rowDocumentId, { seeded: true });
      const before = await rowBodyState(state.target.rowDocumentId);
      const { contentLiveCopy } =
        await import("../server/live-copy/binding.js");
      const run = contentLiveCopy.runner.run.bind(contentLiveCopy.runner);
      const spy = vi
        .spyOn(contentLiveCopy.runner, "run")
        .mockImplementationOnce(
          async <Output>(task: string, input: unknown): Promise<Output> => {
            const output = await run<Output>(task, input);
            await getDb()
              .update(schema.documents)
              .set({ title: "Title committed first" })
              .where(eq(schema.documents.id, state.target.rowDocumentId));
            return output;
          },
        );
      try {
        await expect(
          asOwner(() =>
            mutateBlock.run({
              ...envelope(state, "overtaking-title"),
              operation: "update",
              blockId: state.listed.order[0],
              block: {
                kind: "paragraph",
                nfm: changed ? "Agent write" : "Alpha",
              },
            }),
          ),
        ).rejects.toMatchObject({ errorCode: "ROW_REVISION_CONFLICT" });
        expect(await rowBodyState(state.target.rowDocumentId)).toEqual(before);
        const current = await asOwner(() =>
          listBlocks.run({ target: state.target, limit: 100 }),
        );
        expect(current.rowRevision).not.toBe(state.listed.rowRevision);
        expect(current.fieldRevision).toBe(state.listed.fieldRevision);
        expect(current.order).toEqual(state.listed.order);
        expect(
          await getDb()
            .select()
            .from(schema.contentDatabaseRowMutationReceipts)
            .where(
              and(
                eq(
                  schema.contentDatabaseRowMutationReceipts.databaseId,
                  state.databaseId,
                ),
                eq(
                  schema.contentDatabaseRowMutationReceipts.idempotencyKey,
                  "overtaking-title",
                ),
              ),
            ),
        ).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    },
  );

  // oracle-change: primary block actions now commit through the live copy instead of refusing switched rows.
  it.each([false, true])(
    "refuses a primary mapping removed while the worker builds (changed: %s)",
    async (changed) => {
      const state = await fixture("Alpha\nBeta");
      await putPageOnLiveCopy(state.target.rowDocumentId, { seeded: true });
      const before = await rowBodyState(state.target.rowDocumentId);
      const fields = () =>
        getDb()
          .select()
          .from(schema.documentBlockFields)
          .where(
            eq(
              schema.documentBlockFields.documentId,
              state.target.rowDocumentId,
            ),
          )
          .orderBy(schema.documentBlockFields.id);
      const fieldsBefore = await fields();
      const { contentLiveCopy } =
        await import("../server/live-copy/binding.js");
      const run = contentLiveCopy.runner.run.bind(contentLiveCopy.runner);
      const spy = vi
        .spyOn(contentLiveCopy.runner, "run")
        .mockImplementationOnce(
          async <Output>(task: string, input: unknown): Promise<Output> => {
            const result = await run<Output>(task, input);
            await getDb()
              .update(schema.contentDatabases)
              .set({ primaryBlocksPropertyId: null })
              .where(eq(schema.contentDatabases.id, state.databaseId));
            return result;
          },
        );
      try {
        await expect(
          asOwner(() =>
            mutateBlock.run({
              ...envelope(state, "removed-primary"),
              operation: "update",
              blockId: state.listed.order[0],
              block: {
                kind: "paragraph",
                nfm: changed ? "Agent write" : "Alpha",
              },
            }),
          ),
        ).rejects.toMatchObject({
          errorCode: "DOCUMENT_METADATA_SCOPE_CHANGED",
        });
        expect(await rowBodyState(state.target.rowDocumentId)).toEqual(before);
        expect(await fields()).toEqual(fieldsBefore);
        expect(
          await getDb()
            .select()
            .from(schema.contentDatabaseRowMutationReceipts)
            .where(
              and(
                eq(
                  schema.contentDatabaseRowMutationReceipts.databaseId,
                  state.databaseId,
                ),
                eq(
                  schema.contentDatabaseRowMutationReceipts.idempotencyKey,
                  "removed-primary",
                ),
              ),
            ),
        ).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("commits a primary block mutation through the row's live copy", async () => {
    const state = await fixture("Alpha\nBeta");
    await putPageOnLiveCopy(state.target.rowDocumentId, { seeded: true });
    const before = await rowBodyState(state.target.rowDocumentId);
    expect(before.history).toBe(0);
    const result = await asOwner(() =>
      mutateBlock.run({
        ...envelope(state, "live-copy-update"),
        operation: "update",
        blockId: state.listed.order[0],
        block: { kind: "paragraph", nfm: "Agent write" },
      }),
    );
    const after = await rowBodyState(state.target.rowDocumentId);
    expect(after).toEqual({
      content: "Agent write\nBeta",
      bodyRevision: before.bodyRevision + 1,
      liveCopyVersion: required(before.liveCopyVersion) + 1,
      history: 2,
    });
    expect(
      await getDb()
        .select({
          content: schema.documentVersions.content,
          kind: schema.documentVersions.checkpointKind,
          revision: schema.documentVersions.bodyRevision,
        })
        .from(schema.documentVersions)
        .where(
          eq(schema.documentVersions.documentId, state.target.rowDocumentId),
        )
        .orderBy(schema.documentVersions.bodyRevision),
    ).toEqual([
      {
        content: before.content,
        kind: "before",
        revision: before.bodyRevision,
      },
      { content: after.content, kind: "after", revision: after.bodyRevision },
    ]);
    const { readLiveCopy } = await import("@agent-native/core/collab");
    const { contentLiveCopy } = await import("../server/live-copy/binding.js");
    const stored = await readLiveCopy(
      contentLiveCopy,
      state.target.rowDocumentId,
    );
    expect(stored).toMatchObject({
      text: after.content,
      version: after.liveCopyVersion,
    });
    expect(result.receipt.readback.order).toEqual(state.listed.order);
    expect(result.receipt.revisions.field).toEqual({
      before: state.listed.fieldRevision,
      after: state.listed.fieldRevision + 1,
    });
    expect(
      await getDb()
        .select()
        .from(schema.contentDatabaseRowMutationReceipts)
        .where(
          and(
            eq(
              schema.contentDatabaseRowMutationReceipts.databaseId,
              state.databaseId,
            ),
            eq(
              schema.contentDatabaseRowMutationReceipts.idempotencyKey,
              "live-copy-update",
            ),
          ),
        ),
    ).toHaveLength(1);
  });

  it("lets a switched row take a block mutation while its flags are off (SF-11)", async () => {
    const state = await fixture("Alpha\nBeta");
    await putPageOnLiveCopy(state.target.rowDocumentId);
    await turnLiveCopyFlagsOff();
    const before = await rowBodyState(state.target.rowDocumentId);

    await asOwner(() =>
      mutateBlock.run({
        ...envelope(state, "flags-off-update"),
        operation: "update",
        blockId: state.listed.blocks[0]!.id,
        block: { kind: "paragraph", nfm: "Agent write" },
      }),
    );

    expect(await rowBodyState(state.target.rowDocumentId)).toEqual({
      ...before,
      content: "Agent write\nBeta",
      bodyRevision: before.bodyRevision + 1,
    });
  });

  // The backfill switches Files rows, so this writer must never reach one.
  it("refuses a block mutation of a Files row, so no legacy-only writer reaches a page the backfill switches", async () => {
    const state = await fixture("Alpha\nBeta");
    const [files] = await getDb()
      .select({
        id: schema.contentDatabases.id,
        documentId: schema.contentDatabases.documentId,
        itemId: schema.contentDatabaseItems.id,
      })
      .from(schema.contentDatabases)
      .innerJoin(
        schema.contentDatabaseItems,
        eq(schema.contentDatabaseItems.databaseId, schema.contentDatabases.id),
      )
      .where(
        and(
          eq(schema.contentDatabases.spaceId, state.target.spaceId),
          eq(schema.contentDatabases.systemRole, "files"),
          eq(
            schema.contentDatabaseItems.documentId,
            state.target.rowDocumentId,
          ),
        ),
      );
    expect(files).toBeDefined();
    const before = await rowBodyState(state.target.rowDocumentId);

    await expect(
      asOwner(() =>
        mutateBlock.run({
          ...envelope(state, "files-row-update"),
          target: {
            ...state.target,
            databaseId: files.id,
            databaseDocumentId: files.documentId,
            itemId: files.itemId,
          },
          operation: "update",
          blockId: state.listed.blocks[0].id,
          block: { kind: "paragraph", nfm: "Agent write" },
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "SYSTEM_DATABASE_UNSUPPORTED",
      statusCode: 400,
    });
    expect(await rowBodyState(state.target.rowDocumentId)).toEqual(before);
  });
});
