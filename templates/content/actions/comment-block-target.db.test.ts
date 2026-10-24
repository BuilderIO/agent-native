import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { derivedVideoBlockId } from "../shared/comment-block-anchor.js";

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
  `content-comment-block-target-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const SAVED = "https://example.com/saved.mp4";
const LEGACY = "https://example.com/legacy.mp4";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let createContentDatabase: typeof import("./create-content-database.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;
let addComment: typeof import("./add-comment.js").default;
let listComments: typeof import("./list-comments.js").default;
let createDocument: typeof import("./create-document.js").default;

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
  setDocumentProperty = (await import("./set-document-property.js")).default;
  addComment = (await import("./add-comment.js")).default;
  listComments = (await import("./list-comments.js")).default;
  createDocument = (await import("./create-document.js")).default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function as<T>(run: () => Promise<T>) {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

// A person comments from the app; an agent comments as a tool.
const byPerson = (args: Record<string, unknown>) =>
  as(() => (addComment as any).run(args));
const byAgent = (args: Record<string, unknown>) =>
  as(() => (addComment as any).run(args, { caller: "mcp" }));

async function seedPage(id: string) {
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      ownerEmail: OWNER,
      title: "Clips",
      content: [
        "Intro",
        `<video src="${SAVED}" id="video-saved001">Demo</video>`,
        `<video src="${LEGACY}"></video>`,
      ].join("\n"),
    });
  return id;
}

async function storedComment(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documentComments)
    .where(eq(schema.documentComments.id, id));
  return row;
}

async function rejection(run: Promise<unknown>) {
  return run.then(
    () => {
      throw new Error("Expected the comment to be refused");
    },
    (error: { statusCode?: number; errorCode?: string }) => ({
      statusCode: error.statusCode,
      errorCode: error.errorCode,
    }),
  );
}

describe("document_comments migration", () => {
  it("adds nullable block_id and block_type columns", async () => {
    const result = await getDb().execute(
      sql`SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name = 'document_comments'
            AND column_name IN ('block_id', 'block_type')
          ORDER BY column_name`,
    );
    expect(result.rows ?? result).toEqual([
      { column_name: "block_id", is_nullable: "YES" },
      { column_name: "block_type", is_nullable: "YES" },
    ]);
  });
});

describe("add-comment with a quote and no context", () => {
  async function seedNotes(id: string) {
    await getDb()
      .insert(schema.documents)
      .values({
        id,
        ownerEmail: OWNER,
        title: "Notes",
        content: `Video notes\n<video src="${SAVED}" id="video-saved001"></video>\nOutro`,
      });
    return id;
  }

  it("keeps the text around the quote, as the editor counts it", async () => {
    const page = await seedNotes("quote-context");
    const first = await byAgent({
      documentId: page,
      content: "Which video?",
      quotedText: "Video",
    });
    expect(await storedComment(first.id)).toMatchObject({
      quotedText: "Video",
      anchorPrefix: "",
      anchorSuffix: " notesOutro",
      anchorStartOffset: 0,
      blockId: null,
    });
    const second = await byAgent({
      documentId: page,
      content: "Plural?",
      quotedText: "notes",
    });
    expect(await storedComment(second.id)).toMatchObject({
      anchorPrefix: "Video ",
      anchorSuffix: "Outro",
      anchorStartOffset: 6,
    });
  });

  it("keeps the context a caller sends", async () => {
    const page = await seedNotes("quote-given");
    const created = await byAgent({
      documentId: page,
      content: "Here",
      quotedText: "Video",
      anchorSuffix: " notes",
    });
    expect(await storedComment(created.id)).toMatchObject({
      anchorPrefix: null,
      anchorSuffix: " notes",
      anchorStartOffset: null,
    });
  });

  it("leaves a quote the page doesn't have without context", async () => {
    const page = await seedNotes("quote-missing");
    const created = await byAgent({
      documentId: page,
      content: "Gone?",
      quotedText: "Intro",
    });
    expect(await storedComment(created.id)).toMatchObject({
      anchorPrefix: null,
      anchorSuffix: null,
      anchorStartOffset: null,
    });
  });

  it("replays a retried submission after the text around its quote changed", async () => {
    const page = await seedNotes("quote-retry");
    const args = {
      documentId: page,
      content: "Retry me",
      quotedText: "notes",
      idempotencyKey: "quote-retry",
    };
    const created = await byAgent(args);
    await getDb()
      .update(schema.documents)
      .set({ content: "Some notes" })
      .where(eq(schema.documents.id, page));
    expect(await byAgent(args)).toMatchObject({
      id: created.id,
      replayed: true,
    });
  });
});

describe("add-comment with blockId", () => {
  it("starts a thread on a video an agent read from the page", async () => {
    const page = await seedPage("block-agent");
    const created = await byAgent({
      documentId: page,
      content: "Trim the intro",
      blockId: "video-saved001",
    });
    expect(await storedComment(created.id)).toMatchObject({
      threadId: created.id,
      quotedText: null,
      blockId: "video-saved001",
      blockType: "video",
    });

    const { comments } = await as(() =>
      (listComments as any).run({ documentId: page }),
    );
    expect(comments).toEqual([
      expect.objectContaining({
        thread_id: created.threadId,
        quoted_text: null,
        block_id: "video-saved001",
        block_type: "video",
      }),
    ]);
  });

  it("tells an agent to save an id on a video that goes by a derived one", async () => {
    const page = await seedPage("block-derived");
    expect(
      await rejection(
        byAgent({
          documentId: page,
          content: "Louder",
          blockId: derivedVideoBlockId(LEGACY, 0),
        }),
      ),
    ).toEqual({ statusCode: 400, errorCode: "comment_block_id_unsaved" });
  });

  it("finds a video saved without an id for a person, by the id every reader derives", async () => {
    const page = await seedPage("block-derived-person");
    const created = await byPerson({
      documentId: page,
      content: "Louder",
      blockId: derivedVideoBlockId(LEGACY, 0),
    });
    expect(await storedComment(created.id)).toMatchObject({
      blockId: derivedVideoBlockId(LEGACY, 0),
      blockType: "video",
    });
  });

  it("tells an agent to give one of two videos that share an id a new one", async () => {
    await getDb()
      .insert(schema.documents)
      .values({
        id: "block-shared",
        ownerEmail: OWNER,
        title: "Clips",
        content: [
          `<video src="${LEGACY}" id="video-shared01"></video>`,
          `<video src="${SAVED}" id="video-shared01"></video>`,
        ].join("\n"),
      });
    expect(
      await rejection(
        byAgent({
          documentId: "block-shared",
          content: "Which one?",
          blockId: "video-shared01",
        }),
      ),
    ).toEqual({ statusCode: 400, errorCode: "comment_block_id_shared" });
  });

  it("keeps a saved id on its video when a video added above derives the same one", async () => {
    const written = derivedVideoBlockId(LEGACY, 0);
    await getDb()
      .insert(schema.documents)
      .values({
        id: "block-added-above",
        ownerEmail: OWNER,
        title: "Clips",
        content: [
          `<video src="${LEGACY}"></video>`,
          `<video src="${LEGACY}" id="${written}"></video>`,
        ].join("\n"),
      });
    const created = await byAgent({
      documentId: "block-added-above",
      content: "Still this one",
      blockId: written,
    });
    expect(await storedComment(created.id)).toMatchObject({
      blockId: written,
      blockType: "video",
    });
  });

  it("tells an agent when no block has that id", async () => {
    const page = await seedPage("block-missing");
    expect(
      await rejection(
        byAgent({ documentId: page, content: "Hm", blockId: "video-nothere" }),
      ),
    ).toEqual({ statusCode: 400, errorCode: "comment_block_not_found" });
  });

  it("keeps a person's thread on a video their editor has not saved yet", async () => {
    const page = await seedPage("block-unsaved");
    const created = await byPerson({
      documentId: page,
      content: "Nice",
      blockId: "video-justmade",
      blockType: "video",
    });
    expect(await storedComment(created.id)).toMatchObject({
      quotedText: null,
      blockId: "video-justmade",
      blockType: "video",
    });
  });

  it("refuses a block with a quote, a Property, or on a reply", async () => {
    const page = await seedPage("block-conflict");
    const root = await byAgent({
      documentId: page,
      content: "Root",
      blockId: "video-saved001",
    });
    const conflicts = [
      { quotedText: "Intro" },
      { anchorPrefix: "In" },
      { propertyId: "status" },
      { threadId: root.threadId, parentId: root.id },
    ];
    for (const conflict of conflicts) {
      expect(
        await rejection(
          byAgent({
            documentId: page,
            content: "Again",
            blockId: "video-saved001",
            ...conflict,
          }),
        ),
      ).toEqual({
        statusCode: 400,
        errorCode: "comment_block_target_conflict",
      });
    }
    expect(
      await rejection(
        byAgent({ documentId: page, content: "Type only", blockType: "video" }),
      ),
    ).toEqual({ statusCode: 400, errorCode: "comment_block_target_conflict" });
  });

  it("replays a retried submission after its video was deleted", async () => {
    const page = await seedPage("block-retry");
    const args = {
      documentId: page,
      content: "Retry me",
      blockId: "video-saved001",
      idempotencyKey: "block-retry",
    };
    const created = await byAgent(args);
    await getDb()
      .update(schema.documents)
      .set({ content: "Intro" })
      .where(eq(schema.documents.id, page));
    expect(await byAgent(args)).toMatchObject({
      id: created.id,
      replayed: true,
    });
  });

  it("starts a thread on a video in a Blocks field tab", async () => {
    const { row, databaseId, notesId } = await as(async () => {
      const created = await createContentDatabase.run({ title: "Board" });
      const databaseId = created.database.id;
      const documentId = created.database.documentId;
      const configured = await configureDocumentProperty.run({
        documentId,
        databaseId,
        name: "Notes",
        type: "blocks",
      });
      const notesId = configured.properties.find(
        (property) => property.definition.name === "Notes",
      )!.definition.id;
      const read = await getContentDatabase.run({ databaseId });
      if (!("database" in read) || !read.mutationContract)
        throw new Error("Fixture Collection has no mutation contract.");
      const added = await addDatabaseItem.run({
        target: read.mutationContract.target,
        expectedSchemaRevision: read.mutationContract.schemaRevision,
        idempotencyKey: "block-field-row",
        title: "Row",
      });
      return {
        row: added.receipt.row.documentId as string,
        databaseId,
        notesId,
      };
    });
    await as(() =>
      setDocumentProperty.run({
        documentId: row,
        databaseId,
        propertyId: notesId,
        value: `Tab notes\n<video src="${SAVED}" id="video-innotes"></video>`,
      }),
    );

    const quoted = await byAgent({
      documentId: row,
      content: "Rename",
      fieldId: notesId,
      quotedText: "notes",
    });
    expect(await storedComment(quoted.id)).toMatchObject({
      fieldId: notesId,
      anchorPrefix: "Tab ",
      anchorSuffix: "",
      anchorStartOffset: 4,
    });

    const created = await byAgent({
      documentId: row,
      content: "In the tab",
      fieldId: notesId,
      blockId: "video-innotes",
    });
    expect(await storedComment(created.id)).toMatchObject({
      fieldId: notesId,
      quotedText: null,
      blockId: "video-innotes",
      blockType: "video",
    });
    expect(
      await rejection(
        byAgent({
          documentId: row,
          content: "Not in the tab",
          fieldId: notesId,
          blockId: "video-saved001",
        }),
      ),
    ).toEqual({ statusCode: 400, errorCode: "comment_block_not_found" });

    const write = (value: string, ctx?: unknown) =>
      as(() =>
        (setDocumentProperty as any).run(
          { documentId: row, databaseId, propertyId: notesId, value },
          ctx,
        ),
      );
    const copied = `Tab notes\n<video src="${SAVED}" id="video-innotes"></video>\n<video src="${LEGACY}" id="video-innotes"></video>`;
    expect(await rejection(write(copied))).toEqual({
      statusCode: 422,
      errorCode: "DOCUMENT_VIDEO_ID_SHARED",
    });
    await write(copied, { caller: "frontend" });
    expect(
      await rejection(
        byAgent({
          documentId: row,
          content: "Which one?",
          fieldId: notesId,
          blockId: "video-innotes",
        }),
      ),
    ).toEqual({ statusCode: 400, errorCode: "comment_block_id_shared" });
  });

  it("refuses a new page that gives two videos one id", async () => {
    const video = `<video src="${SAVED}" id="video-twice001"></video>`;
    expect(
      await rejection(
        as(() =>
          (createDocument as any).run(
            { title: "Twice", content: `${video}\n${video}` },
            { caller: "mcp" },
          ),
        ),
      ),
    ).toEqual({ statusCode: 422, errorCode: "DOCUMENT_VIDEO_ID_SHARED" });
  });
});
