import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));
vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => false),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-blocks-field-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let createContentDatabase: typeof import("./create-content-database.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let addComment: typeof import("./add-comment.js").default;
let listComments: typeof import("./list-comments.js").default;
let listDatabaseComments: typeof import("./list-content-database-comments.js").default;
let resolveCommentBlocksField: typeof import("../server/lib/comment-blocks-field.js").resolveCommentBlocksField;
let startCommentAiRequest: typeof import("../server/lib/comment-ai.js").startCommentAiRequest;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createContentDatabase = (await import("./create-content-database.js"))
    .default;
  configureDocumentProperty = (await import("./configure-document-property.js"))
    .default;
  getContentDatabase = (await import("./get-content-database.js")).default;
  addDatabaseItem = (await import("./add-database-item.js")).default;
  addComment = (await import("./add-comment.js")).default;
  listComments = (await import("./list-comments.js")).default;
  listDatabaseComments = (await import("./list-content-database-comments.js"))
    .default;
  ({ resolveCommentBlocksField } =
    await import("../server/lib/comment-blocks-field.js"));
  ({ startCommentAiRequest } = await import("../server/lib/comment-ai.js"));
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function as<T>(run: () => Promise<T>) {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

const add = (args: Record<string, unknown>) =>
  as(() => (addComment as any).run(args));

/**
 * A Collection with its primary Blocks field, a second Blocks field, and a
 * Number Property, plus one row and a Page outside any Collection.
 */
async function seedCollection(suffix: string) {
  return as(async () => {
    const created = await createContentDatabase.run({
      title: `Board ${suffix}`,
    });
    const databaseId = created.database.id;
    const documentId = created.database.documentId;
    const configure = (name: string, type: "blocks" | "number") =>
      configureDocumentProperty.run({ documentId, databaseId, name, type });
    await configure("Notes", "blocks");
    const configured = await configure("Score", "number");
    const byName = (name: string) =>
      configured.properties.find(
        (property) => property.definition.name === name,
      )!.definition;
    const primary = configured.properties.find(
      (property) =>
        property.definition.type === "blocks" &&
        property.definition.options.blocks?.primary === true,
    )!.definition;
    const read = await getContentDatabase.run({ databaseId });
    if (!("database" in read) || !read.mutationContract)
      throw new Error("Fixture Collection has no mutation contract.");
    const row = await addDatabaseItem.run({
      target: read.mutationContract.target,
      expectedSchemaRevision: read.mutationContract.schemaRevision,
      idempotencyKey: `blocks-field-comments-${suffix}`,
      title: "Row",
    });
    const page = `loose-page-${suffix}`;
    await getDb().insert(schema.documents).values({
      id: page,
      ownerEmail: OWNER,
      title: "Loose page",
      content: "Lorem ipsum dolor sit amet",
    });
    return {
      databaseId,
      row: row.receipt.row.documentId as string,
      page,
      primaryId: primary.id,
      notesId: byName("Notes").id,
      scoreId: byName("Score").id,
    };
  });
}

async function storedComment(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documentComments)
    .where(eq(schema.documentComments.id, id));
  return row;
}

describe("document_comments migration", () => {
  it("adds nullable field_id and field_name columns", async () => {
    const result = await getDb().execute(
      sql`SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name = 'document_comments'
            AND column_name IN ('field_id', 'field_name')
          ORDER BY column_name`,
    );
    const rows = (result.rows ?? result) as Array<{
      column_name: string;
      is_nullable: string;
    }>;
    expect(rows).toEqual([
      { column_name: "field_id", is_nullable: "YES" },
      { column_name: "field_name", is_nullable: "YES" },
    ]);
  });
});

describe("resolveCommentBlocksField", () => {
  it("maps no field and the primary field to the body", async () => {
    const fixture = await seedCollection("resolver-body");
    await expect(
      resolveCommentBlocksField(fixture.row, undefined),
    ).resolves.toEqual({ fieldId: null, fieldName: null });
    await expect(
      resolveCommentBlocksField(fixture.row, fixture.primaryId),
    ).resolves.toEqual({ fieldId: null, fieldName: null });
  });

  it("names another Blocks field of the row's Collection", async () => {
    const fixture = await seedCollection("resolver-field");
    await expect(
      resolveCommentBlocksField(fixture.row, fixture.notesId),
    ).resolves.toEqual({ fieldId: fixture.notesId, fieldName: "Notes" });
  });

  it("refuses a field the Page doesn't have, and a non-Blocks Property", async () => {
    const fixture = await seedCollection("resolver-refusals");
    await expect(
      resolveCommentBlocksField(fixture.row, "no-such-field"),
    ).rejects.toMatchObject({ errorCode: "comment_field_not_found" });
    await expect(
      resolveCommentBlocksField(fixture.page, fixture.notesId),
    ).rejects.toMatchObject({ errorCode: "comment_field_not_found" });
    await expect(
      resolveCommentBlocksField(fixture.row, fixture.scoreId),
    ).rejects.toMatchObject({ errorCode: "comment_field_not_blocks" });
  });
});

describe("add-comment with fieldId", () => {
  it("stores the field and its name on a new thread", async () => {
    const fixture = await seedCollection("root");
    const created = await add({
      documentId: fixture.row,
      content: "Lorem ipsum",
      fieldId: fixture.notesId,
      quotedText: "dolor",
    });
    const stored = await storedComment(created.id);
    expect(stored.fieldId).toBe(fixture.notesId);
    expect(stored.fieldName).toBe("Notes");
    expect(stored.quotedText).toBe("dolor");
  });

  it("stores the body as null, with or without the primary field's ID", async () => {
    const fixture = await seedCollection("body");
    const plain = await add({ documentId: fixture.row, content: "Lorem" });
    const primary = await add({
      documentId: fixture.row,
      content: "Ipsum",
      fieldId: fixture.primaryId,
    });
    for (const id of [plain.id, primary.id]) {
      const stored = await storedComment(id);
      expect(stored.fieldId).toBeNull();
      expect(stored.fieldName).toBeNull();
    }
  });

  it("refuses an unknown field, a non-Blocks Property, and a Page outside a Collection", async () => {
    const fixture = await seedCollection("refusals");
    await expect(
      add({ documentId: fixture.row, content: "Lorem", fieldId: "missing" }),
    ).rejects.toMatchObject({ errorCode: "comment_field_not_found" });
    await expect(
      add({
        documentId: fixture.row,
        content: "Lorem",
        fieldId: fixture.scoreId,
      }),
    ).rejects.toMatchObject({ errorCode: "comment_field_not_blocks" });
    await expect(
      add({
        documentId: fixture.page,
        content: "Lorem",
        fieldId: fixture.notesId,
      }),
    ).rejects.toMatchObject({ errorCode: "comment_field_not_found" });
  });

  it("refuses fieldId together with propertyId", async () => {
    const fixture = await seedCollection("property-conflict");
    await expect(
      add({
        documentId: fixture.row,
        content: "Lorem",
        fieldId: fixture.notesId,
        propertyId: fixture.scoreId,
      }),
    ).rejects.toMatchObject({ errorCode: "comment_field_property_conflict" });
  });

  it("puts a reply in its thread's tab and refuses a reply to another tab", async () => {
    const fixture = await seedCollection("replies");
    const root = await add({
      documentId: fixture.row,
      content: "Lorem",
      fieldId: fixture.notesId,
    });
    const reply = await add({
      documentId: fixture.row,
      content: "Ipsum",
      threadId: root.threadId,
      parentId: root.id,
    });
    const sameTab = await add({
      documentId: fixture.row,
      content: "Dolor",
      threadId: root.threadId,
      parentId: root.id,
      fieldId: fixture.notesId,
    });
    for (const id of [reply.id, sameTab.id]) {
      const stored = await storedComment(id);
      expect(stored.fieldId).toBe(fixture.notesId);
      expect(stored.fieldName).toBe("Notes");
    }
    await expect(
      add({
        documentId: fixture.row,
        content: "Sit",
        threadId: root.threadId,
        parentId: root.id,
        fieldId: fixture.primaryId,
      }),
    ).rejects.toMatchObject({ errorCode: "comment_field_reply_mismatch" });

    const bodyRoot = await add({ documentId: fixture.row, content: "Amet" });
    const bodyReply = await add({
      documentId: fixture.row,
      content: "Consectetur",
      threadId: bodyRoot.threadId,
      parentId: bodyRoot.id,
      fieldId: fixture.primaryId,
    });
    expect((await storedComment(bodyReply.id)).fieldId).toBeNull();
    await expect(
      add({
        documentId: fixture.row,
        content: "Adipiscing",
        threadId: bodyRoot.threadId,
        parentId: bodyRoot.id,
        fieldId: fixture.notesId,
      }),
    ).rejects.toMatchObject({ errorCode: "comment_field_reply_mismatch" });
  });

  it("replays a retried submission without a conflict", async () => {
    const fixture = await seedCollection("retry");
    const args = {
      documentId: fixture.row,
      content: "Lorem",
      fieldId: fixture.notesId,
      idempotencyKey: "retry-field-comment",
    };
    const first = await add(args);
    const second = await add(args);
    expect(second).toMatchObject({ id: first.id, replayed: true });
  });
});

describe("listing comments by tab", () => {
  it("returns the field on every comment, null for the body and older comments", async () => {
    const fixture = await seedCollection("list");
    const root = await add({
      documentId: fixture.row,
      content: "Lorem",
      fieldId: fixture.notesId,
    });
    await add({
      documentId: fixture.row,
      content: "Ipsum",
      threadId: root.threadId,
      parentId: root.id,
    });
    await add({ documentId: fixture.row, content: "Dolor" });
    // A comment written before tabs had comments: no field at all.
    await getDb()
      .insert(schema.documentComments)
      .values({
        id: `legacy-${fixture.row}`,
        ownerEmail: OWNER,
        documentId: fixture.row,
        threadId: `legacy-${fixture.row}`,
        content: "Sit amet",
        authorEmail: OWNER,
      });

    const listed = await as(() =>
      listComments.run({ documentId: fixture.row }),
    );
    const byContent = new Map(
      listed.comments.map((comment) => [comment.content, comment]),
    );
    expect(byContent.get("Lorem")).toMatchObject({
      field_id: fixture.notesId,
      field_name: "Notes",
    });
    expect(byContent.get("Ipsum")).toMatchObject({
      field_id: fixture.notesId,
      field_name: "Notes",
    });
    expect(byContent.get("Dolor")).toMatchObject({
      field_id: null,
      field_name: null,
    });
    expect(byContent.get("Sit amet")).toMatchObject({
      field_id: null,
      field_name: null,
    });
  });

  it("returns each thread's tab across a Collection", async () => {
    const fixture = await seedCollection("collection");
    const tab = await add({
      documentId: fixture.row,
      content: "Lorem",
      fieldId: fixture.notesId,
      quotedText: "ipsum",
    });
    const body = await add({ documentId: fixture.row, content: "Dolor" });
    const listed = await as(() =>
      listDatabaseComments.run({ databaseId: fixture.databaseId }),
    );
    const byThread = new Map(
      listed.threads.map((thread) => [thread.threadId, thread]),
    );
    expect(byThread.get(tab.threadId)).toMatchObject({
      fieldId: fixture.notesId,
      fieldName: "Notes",
      target: { kind: "text", quotedText: "ipsum" },
    });
    expect(byThread.get(body.threadId)).toMatchObject({
      fieldId: null,
      fieldName: null,
    });
  });

  it("keeps a deleted field's threads under the name it had", async () => {
    const fixture = await seedCollection("deleted");
    const root = await add({
      documentId: fixture.row,
      content: "Lorem",
      fieldId: fixture.notesId,
    });
    await getDb()
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, fixture.notesId));
    const listed = await as(() =>
      listComments.run({ documentId: fixture.row }),
    );
    expect(
      listed.comments.find((comment) => comment.id === root.id),
    ).toMatchObject({ field_id: fixture.notesId, field_name: "Notes" });
    const reply = await add({
      documentId: fixture.row,
      content: "Ipsum",
      threadId: root.threadId,
      parentId: root.id,
    });
    expect(await storedComment(reply.id)).toMatchObject({
      fieldId: fixture.notesId,
      fieldName: "Notes",
    });
  });
});

describe("Ask AI on a tab's thread", () => {
  it("is refused with a typed error and records no request", async () => {
    const fixture = await seedCollection("ask-ai");
    const tab = await add({
      documentId: fixture.row,
      content: "Lorem",
      fieldId: fixture.notesId,
    });
    await expect(
      as(() =>
        startCommentAiRequest({
          requestId: "44444444-4444-4444-8444-444444444444",
          documentId: fixture.row,
          threadId: tab.threadId,
          rootCommentId: tab.id,
          intent: "reply",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_ai_field_unsupported" });
    const [request] = await getDb()
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.threadId, tab.threadId));
    expect(request).toBeUndefined();
  });
});
