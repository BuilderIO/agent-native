import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SuggestionOperation } from "@agent-native/core/review";
import { runWithRequestContext } from "@agent-native/core/server";
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
let getDocumentAction: typeof import("../../actions/get-document.js").default;
let updateDocumentAction: typeof import("../../actions/update-document.js").default;
let commentThreadDigest: typeof import("./comment-ai.js").commentThreadDigest;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDbExec = (await import("@agent-native/core/db")).getDbExec;
  adapter = (await import("./suggested-edits.js"))
    .contentDocumentSuggestionAdapter;
  getDocumentAction = (await import("../../actions/get-document.js")).default;
  updateDocumentAction = (await import("../../actions/update-document.js"))
    .default;
  commentThreadDigest = (await import("./comment-ai.js")).commentThreadDigest;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

const ownerEmail = "owner@example.com";
let sequence = 0;

async function seedSystemDatabasePage(ordinaryMembershipCount = 0) {
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
  const ordinaryPropertyIds: string[] = [];
  for (let index = 0; index < ordinaryMembershipCount; index += 1) {
    const ordinaryDatabaseId = `suggestion-ordinary-db-${suffix}-${index}`;
    const ordinaryPropertyId = `suggestion-ordinary-blocks-${suffix}-${index}`;
    ordinaryPropertyIds.push(ordinaryPropertyId);
    await db.insert(schema.documents).values({
      id: `suggestion-ordinary-db-page-${suffix}-${index}`,
      title: "Collection",
      content: "",
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabases).values({
      id: ordinaryDatabaseId,
      ownerEmail,
      documentId: `suggestion-ordinary-db-page-${suffix}-${index}`,
      title: "Collection",
      primaryBlocksPropertyId: ordinaryPropertyId,
      blocksSeeded: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.documentPropertyDefinitions).values({
      id: ordinaryPropertyId,
      ownerEmail,
      databaseId: ordinaryDatabaseId,
      name: "Content",
      type: "blocks",
      optionsJson: JSON.stringify({ blocks: { primary: true } }),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: `suggestion-ordinary-item-${suffix}-${index}`,
      ownerEmail,
      databaseId: ordinaryDatabaseId,
      documentId,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { documentId, databaseDocumentId, propertyId, ordinaryPropertyIds };
}

async function seedMetadataOnlyDatabasePage() {
  sequence += 1;
  const suffix = `${sequence}`;
  const documentId = `suggestion-metadata-page-${suffix}`;
  const databaseId = `suggestion-metadata-db-${suffix}`;
  const now = new Date().toISOString();
  const db = getDb();
  await db.insert(schema.documents).values([
    {
      id: documentId,
      title: "Metadata row",
      content: "Before",
      ownerEmail,
      createdAt: now,
      updatedAt: "rev-1",
    },
    {
      id: `suggestion-metadata-db-page-${suffix}`,
      title: "Collection",
      content: "Before",
      ownerEmail,
      createdAt: now,
      updatedAt: "rev-1",
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail,
    documentId: `suggestion-metadata-db-page-${suffix}`,
    title: "Collection",
    blocksSeeded: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: `suggestion-metadata-item-${suffix}`,
    ownerEmail,
    databaseId,
    documentId,
    createdAt: now,
    updatedAt: now,
  });
  return {
    documentId,
    databaseId,
    databaseDocumentId: `suggestion-metadata-db-page-${suffix}`,
  };
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

const contextualOperation = {
  ...operation,
  before: { markdown: "Before", changedText: "Before" },
  after: { markdown: "After", changedText: "After" },
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

async function accept(
  documentId: string,
  tx: DbExec,
  baseRevision = "rev-1",
  acceptedOperation: SuggestionOperation = operation,
  prepared = coordination(),
) {
  const result = await runWithRequestContext({ userEmail: ownerEmail }, () =>
    adapter.apply({
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
        baseRevision,
        status: "pending",
        summary: "Suggest edits",
        ownerEmail,
        orgId: null,
        visibility: "private",
        createdAt: "now",
        updatedAt: "now",
        metadata: null,
        operations: [acceptedOperation],
      },
      operations: [acceptedOperation],
      access: { role: "editor" },
      ctx: {},
      transaction: tx,
      coordination: prepared,
    }),
  );
  return { prepared, result };
}

describe("Content suggested edits Blocks transaction", () => {
  it("accepts a standalone Page without a collection membership", async () => {
    sequence += 1;
    const documentId = `suggestion-standalone-page-${sequence}`;
    await getDb().insert(schema.documents).values({
      id: documentId,
      title: "Standalone Page",
      content: "Before",
      ownerEmail,
      createdAt: new Date().toISOString(),
      updatedAt: "rev-1",
    });

    await getDbExec().transaction!(async (tx) => {
      await accept(documentId, tx);
    });

    const [document] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(document?.content).toBe("After");
  });

  it("honors collection access through a non-active organization", async () => {
    const { documentId, ordinaryPropertyIds } = await seedSystemDatabasePage(1);
    const collaborator = "another-org-member@example.com";
    const organizationId = `suggestion-other-org-${sequence}`;
    const db = getDb();
    const [collection] = await db
      .select({ documentId: schema.contentDatabases.documentId })
      .from(schema.contentDatabases)
      .where(
        eq(
          schema.contentDatabases.primaryBlocksPropertyId,
          ordinaryPropertyIds[0]!,
        ),
      );
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: [organizationId, "Other organization", ownerEmail, 1],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: [
        `suggestion-other-member-${sequence}`,
        organizationId,
        collaborator,
        "member",
        1,
      ],
    });
    await db
      .update(schema.documents)
      .set({ orgId: organizationId, visibility: "org" })
      .where(eq(schema.documents.id, collection!.documentId));

    await expect(
      getDbExec().transaction!(async (tx) =>
        runWithRequestContext(
          { userEmail: collaborator, orgId: "another-active-org" },
          () =>
            adapter.validateProposal({
              resourceType: "document",
              resourceId: documentId,
              baseRevision: "rev-1",
              operations: [operation],
              ctx: { transaction: tx },
            }),
        ),
      ),
    ).resolves.toEqual([operation]);

    const spaceId = `suggestion-other-space-${sequence}`;
    const now = new Date().toISOString();
    await db.insert(schema.contentSpaces).values({
      id: spaceId,
      name: "Other organization",
      kind: "organization",
      ownerEmail,
      orgId: organizationId,
      filesDatabaseId: `suggestion-other-files-${sequence}`,
      createdBy: ownerEmail,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.documents)
      .set({ spaceId })
      .where(eq(schema.documents.id, collection!.documentId));
    const { accessibleDocumentIds } =
      await import("../../actions/_document-access.js");
    await runWithRequestContext({ userEmail: collaborator }, async () => {
      const accessible = await accessibleDocumentIds(
        [collection!.documentId],
        [],
      );
      expect(accessible.has(collection!.documentId)).toBe(true);
    });
    await runWithRequestContext(
      { userEmail: "unrelated@example.com" },
      async () => {
        const accessible = await accessibleDocumentIds(
          [collection!.documentId],
          [],
        );
        expect(accessible.has(collection!.documentId)).toBe(false);
      },
    );
  });

  it("keeps a soft-deleted collection Page excluded at proposal and acceptance", async () => {
    const { databaseId, databaseDocumentId } =
      await seedMetadataOnlyDatabasePage();
    await getDb()
      .update(schema.contentDatabases)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schema.contentDatabases.id, databaseId));

    await expect(
      getDbExec().transaction!(async (tx) =>
        runWithRequestContext({ userEmail: ownerEmail }, () =>
          adapter.validateProposal({
            resourceType: "document",
            resourceId: databaseDocumentId,
            baseRevision: "rev-1",
            operations: [operation],
            ctx: { transaction: tx },
          }),
        ),
      ),
    ).rejects.toThrow(/Collection Pages/);
    await expect(
      getDbExec().transaction!(async (tx) => accept(databaseDocumentId, tx)),
    ).rejects.toThrow(/Collection Pages/);
  });

  it("rejects metadata-only collection items and collection Pages at proposal and acceptance", async () => {
    const { documentId, databaseDocumentId } =
      await seedMetadataOnlyDatabasePage();
    for (const targetId of [documentId, databaseDocumentId]) {
      await expect(
        getDbExec().transaction!(async (tx) =>
          adapter.validateProposal({
            resourceType: "document",
            resourceId: targetId,
            baseRevision: "rev-1",
            operations: [operation],
            ctx: { transaction: tx },
          }),
        ),
      ).rejects.toThrow(
        targetId === documentId
          ? /no primary Blocks field/
          : /Collection Pages/,
      );
      await expect(
        getDbExec().transaction!(async (tx) => accept(targetId, tx)),
      ).rejects.toThrow(
        targetId === documentId
          ? /no primary Blocks field/
          : /Collection Pages/,
      );
    }
    const rows = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(rows).toEqual([{ content: "Before" }]);
  });

  it("rejects acceptance if the last primary Blocks field was removed after proposal", async () => {
    const { documentId, databaseDocumentId } =
      await seedMetadataOnlyDatabasePage();
    const propertyId = `suggestion-metadata-primary-${sequence}`;
    const db = getDb();
    const now = new Date().toISOString();
    await db.insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail,
      databaseId: `suggestion-metadata-db-${sequence}`,
      name: "Content",
      type: "blocks",
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.contentDatabases)
      .set({ primaryBlocksPropertyId: propertyId })
      .where(eq(schema.contentDatabases.documentId, databaseDocumentId));
    await getDbExec().transaction!(async (tx) => {
      await expect(
        runWithRequestContext({ userEmail: ownerEmail }, () =>
          adapter.validateProposal({
            resourceType: "document",
            resourceId: documentId,
            baseRevision: "rev-1",
            operations: [operation],
            ctx: { transaction: tx },
          }),
        ),
      ).resolves.toEqual([operation]);
    });
    await db
      .update(schema.contentDatabases)
      .set({ primaryBlocksPropertyId: null })
      .where(eq(schema.contentDatabases.documentId, databaseDocumentId));
    await expect(
      getDbExec().transaction!(async (tx) => accept(documentId, tx)),
    ).rejects.toThrow(/no primary Blocks field/);
    const [document] = await db
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(document?.content).toBe("Before");
  });

  it("rechecks the eligible field after taking the acceptance membership locks", async () => {
    const { documentId, ordinaryPropertyIds } = await seedSystemDatabasePage(1);
    await expect(
      getDbExec().transaction!(async (tx) => {
        const execute = tx.execute.bind(tx);
        const wrapped = {
          ...tx,
          execute: async (query: Parameters<DbExec["execute"]>[0]) => {
            if (
              typeof query !== "string" &&
              query.sql === "SELECT id FROM documents WHERE id = ? FOR UPDATE"
            ) {
              await execute({
                sql: "UPDATE content_databases SET primary_blocks_property_id = NULL WHERE primary_blocks_property_id = ?",
                args: [ordinaryPropertyIds[0]],
              });
            }
            return execute(query);
          },
        } as DbExec;
        return accept(documentId, wrapped);
      }),
    ).rejects.toThrow(/no primary Blocks field/);
    const [document] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(document?.content).toBe("Before");
  });

  it("rejects a Page that gains an ordinary membership before acceptance locks memberships", async () => {
    const { documentId } = await seedSystemDatabasePage(1);
    const ordinaryDatabaseId = `suggestion-ordinary-db-${sequence}-0`;
    const filesItemId = `suggestion-system-item-${sequence}`;
    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(
        eq(
          schema.contentDatabaseItems.id,
          `suggestion-ordinary-item-${sequence}-0`,
        ),
      );
    await expect(
      getDbExec().transaction!(async (tx) => {
        const execute = tx.execute.bind(tx);
        const wrapped = {
          ...tx,
          execute: async (query: Parameters<DbExec["execute"]>[0]) => {
            if (
              typeof query !== "string" &&
              query.sql === "SELECT id FROM documents WHERE id = ? FOR UPDATE"
            ) {
              await execute({
                sql: "UPDATE content_database_items SET database_id = ? WHERE id = ?",
                args: [ordinaryDatabaseId, filesItemId],
              });
            }
            return execute(query);
          },
        } as DbExec;
        return accept(documentId, wrapped);
      }),
    ).rejects.toThrow(/no primary Blocks field/);
    const [document] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(document?.content).toBe("Before");
  });

  it("returns a retryable conflict when membership writes hold the table lock", async () => {
    const { documentId } = await seedSystemDatabasePage();
    await expect(
      getDbExec().transaction!(async (tx) => {
        const execute = tx.execute.bind(tx);
        const wrapped = {
          ...tx,
          execute: async (query: Parameters<DbExec["execute"]>[0]) => {
            if (
              query ===
              "LOCK TABLE content_database_items IN SHARE ROW EXCLUSIVE MODE NOWAIT"
            ) {
              throw Object.assign(new Error("lock unavailable"), {
                code: "55P03",
              });
            }
            return execute(query);
          },
        } as DbExec;
        return accept(documentId, wrapped);
      }),
    ).rejects.toMatchObject({ errorCode: "suggestion_conflict" });
    const [document] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(document?.content).toBe("Before");
  });

  it("rechecks the bound comment thread inside suggestion creation", async () => {
    const { documentId } = await seedSystemDatabasePage();
    const before = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }),
    );
    const now = new Date().toISOString();
    const comment = {
      id: `comment-ai-root-${sequence}`,
      ownerEmail,
      documentId,
      threadId: `comment-ai-root-${sequence}`,
      parentId: null,
      content: "Please revise this",
      authorEmail: ownerEmail,
      quotedText: null,
      anchorPrefix: null,
      anchorSuffix: null,
      anchorStartOffset: null,
      resolved: 0,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().insert(schema.documentComments).values(comment);
    const requestId = crypto.randomUUID();
    await getDb()
      .insert(schema.commentAiRequests)
      .values({
        id: requestId,
        ownerEmail,
        requesterEmail: ownerEmail,
        documentId,
        threadId: comment.threadId,
        rootCommentId: comment.id,
        fieldId: "body",
        intent: "suggest",
        status: "running",
        threadDigest: commentThreadDigest([comment]),
        snapshotJson: "[]",
        baseRevision: before.baseRevision,
        suggestionRevision: before.baseRevision,
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .update(schema.documentComments)
      .set({ content: "Changed while AI was working" })
      .where(eq(schema.documentComments.id, comment.id));

    await expect(
      getDbExec().transaction!(async (tx) =>
        adapter.validateProposal({
          resourceType: "document",
          resourceId: documentId,
          baseRevision: before.baseRevision,
          operations: [operation],
          metadata: { commentAiRequestId: requestId },
          ctx: { transaction: tx, userEmail: ownerEmail },
        }),
      ),
    ).rejects.toThrow("comment changed");
  });

  it("accepts a Page in multiple ordinary databases and reconciles every primary Blocks field", async () => {
    const { documentId, propertyId, ordinaryPropertyIds } =
      await seedSystemDatabasePage(2);
    const before = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }),
    );
    await getDbExec().transaction!(async (tx) => {
      await expect(
        runWithRequestContext({ userEmail: ownerEmail }, () =>
          adapter.validateProposal({
            resourceType: "document",
            resourceId: documentId,
            baseRevision: before.baseRevision,
            operations: [operation],
            ctx: { transaction: tx },
          }),
        ),
      ).resolves.toEqual([operation]);
    });

    let accepted!: Awaited<ReturnType<typeof accept>>;
    await getDbExec().transaction!(async (tx) => {
      accepted = await accept(documentId, tx, before.baseRevision);
    });

    const after = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }),
    );

    const db = getDb();
    const [document] = await db
      .select({
        content: schema.documents.content,
        collabBodyRevision: schema.documents.collabBodyRevision,
      })
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
    expect(before.bodyRevision).toBe(0);
    expect(after.bodyRevision).toBe(1);
    expect(after.revision).not.toBe(before.revision);
    expect(after.collabContentRevision).toBe(after.revision);
    expect(document?.collabBodyRevision).toBe(1);
    expect(accepted.result).toMatchObject({
      revision: after.revision,
      baseRevision: after.baseRevision,
      bodyRevision: 1,
    });
    expect(field).toMatchObject({ documentId, propertyId, revision: 1 });
    expect(blocks).toEqual([{ markdown: "After" }]);
    for (const ordinaryPropertyId of ordinaryPropertyIds) {
      const [ordinaryField] = await db
        .select()
        .from(schema.documentBlockFields)
        .where(eq(schema.documentBlockFields.propertyId, ordinaryPropertyId));
      const ordinaryBlocks = await db
        .select({ markdown: schema.documentBlocks.markdown })
        .from(schema.documentBlocks)
        .where(eq(schema.documentBlocks.fieldId, ordinaryField!.id));
      expect(ordinaryField).toMatchObject({
        documentId,
        propertyId: ordinaryPropertyId,
        revision: 1,
      });
      expect(ordinaryBlocks).toEqual([{ markdown: "After" }]);
    }
    const versions = await db
      .select({ content: schema.documentVersions.content })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    expect(versions).toEqual([{ content: "Before" }]);
    expect(
      yDocToProsemirrorJSON(accepted.prepared.ydoc.doc, "default"),
    ).toMatchObject({
      content: [{ type: "paragraph", content: [{ text: "After" }] }],
    });

    await runWithRequestContext({ userEmail: ownerEmail }, () =>
      updateDocumentAction.run({ id: documentId, content: "Ordinary save" }),
    );
    const afterOrdinarySave = await runWithRequestContext(
      { userEmail: ownerEmail },
      () => getDocumentAction.run({ id: documentId }),
    );
    expect(afterOrdinarySave.bodyRevision).toBe(2);
    expect(afterOrdinarySave.collabContentRevision).toBeNull();
  });

  it("rolls back the collab marker and canonical writes when prepared Yjs persistence fails", async () => {
    const { documentId, propertyId } = await seedSystemDatabasePage();
    const prepared = coordination();
    prepared.ydoc.persist.mockRejectedValueOnce(
      new Error("forced Yjs persistence failure"),
    );
    await expect(
      getDbExec().transaction!(async (tx) => {
        await accept(documentId, tx, "rev-1", operation, prepared);
      }),
    ).rejects.toThrow("forced Yjs persistence failure");

    const db = getDb();
    const [document] = await db
      .select({
        content: schema.documents.content,
        collabBodyRevision: schema.documents.collabBodyRevision,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const fields = await db
      .select()
      .from(schema.documentBlockFields)
      .where(eq(schema.documentBlockFields.propertyId, propertyId));
    expect(document?.content).toBe("Before");
    expect(document?.collabBodyRevision).toBeNull();
    expect(fields).toEqual([]);
  });

  it("rebases an older saved proposal across an unrelated canonical edit", async () => {
    const { documentId } = await seedSystemDatabasePage();
    await getDb()
      .update(schema.documents)
      .set({ content: "Intro\nBefore", bodyRevision: 1, updatedAt: "rev-2" })
      .where(eq(schema.documents.id, documentId));

    let accepted!: Awaited<ReturnType<typeof accept>>;
    await getDbExec().transaction!(async (tx) => {
      accepted = await accept(documentId, tx, "rev-1", contextualOperation);
    });

    const after = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }),
    );
    expect(after.content).toBe("Intro\nAfter");
    expect(after.bodyRevision).toBe(2);
    expect(accepted.result).toMatchObject({
      revision: after.revision,
      baseRevision: after.baseRevision,
      bodyRevision: 2,
    });
  });
});
