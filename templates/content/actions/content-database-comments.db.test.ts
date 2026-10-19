import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
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
  `content-database-comments-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const COMMENTER = "commenter@example.com";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let createContentDatabase: typeof import("./create-content-database.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;
let addComment: typeof import("./add-comment.js").default;
let updateComment: typeof import("./update-comment.js").default;
let listComments: typeof import("./list-comments.js").default;
let listDatabaseComments: typeof import("./list-content-database-comments.js").default;

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
  updateComment = (await import("./update-comment.js")).default;
  listComments = (await import("./list-comments.js")).default;
  listDatabaseComments = (await import("./list-content-database-comments.js"))
    .default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
  const { scheduleStartupMaintenance } =
    await import("../server/lib/startup-maintenance.js");
  await scheduleStartupMaintenance();
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function as<T>(userEmail: string, run: () => Promise<T>) {
  return runWithRequestContext({ userEmail }, run);
}

/**
 * A Collection with three rows. The commenter can open the Collection and
 * the first two rows; the third row is private to its owner.
 */
async function seedCollection(suffix: string) {
  const fixture = await as(OWNER, async () => {
    const created = await createContentDatabase.run({
      title: `Board ${suffix}`,
    });
    const databaseId = created.database.id;
    const documentId = created.database.documentId;
    const configured = await configureDocumentProperty.run({
      documentId,
      databaseId,
      name: "Score",
      type: "number",
    });
    const scoreId = configured.properties.find(
      (property) => property.definition.name === "Score",
    )!.definition.id;
    const read = await getContentDatabase.run({ databaseId });
    if (!("database" in read) || !read.mutationContract)
      throw new Error("Fixture Collection has no mutation contract.");
    const rows: string[] = [];
    for (const [index, score] of [5, 7, 11].entries()) {
      const row = await addDatabaseItem.run({
        target: read.mutationContract.target,
        expectedSchemaRevision: read.mutationContract.schemaRevision,
        idempotencyKey: `comments-${suffix}-${index}`,
        title: `Row ${index}`,
        propertyValues: { [scoreId]: score },
      });
      rows.push(row.receipt.row.documentId);
    }
    return { databaseId, documentId, scoreId, rows };
  });
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documentShares)
    .values(
      [fixture.documentId, fixture.rows[0]!, fixture.rows[1]!].map(
        (resourceId) => ({
          id: crypto.randomUUID(),
          resourceId,
          principalType: "user" as const,
          principalId: COMMENTER,
          role: "commenter" as const,
          createdBy: OWNER,
          createdAt: now,
        }),
      ),
    );
  return fixture;
}

async function readItems(userEmail: string, databaseId: string) {
  const read = await as(userEmail, () =>
    getContentDatabase.run({ databaseId }, {
      caller: "frontend",
      userEmail,
    } as any),
  );
  if (!("items" in read)) throw new Error("Collection read was unavailable.");
  return new Map(read.items.map((item) => [item.document.id, item]));
}

describe("Comments across a Collection", () => {
  it("records a Property comment's name and value and keeps them after the value changes", async () => {
    const fixture = await seedCollection("property");
    const [row] = fixture.rows;
    const created = await as(COMMENTER, () =>
      (addComment as any).run({
        documentId: row,
        propertyId: fixture.scoreId,
        content: "This should be 8",
      }),
    );
    await as(OWNER, () =>
      setDocumentProperty.run({
        documentId: row!,
        databaseId: fixture.databaseId,
        propertyId: fixture.scoreId,
        value: 8,
      }),
    );
    const { comments } = await as(COMMENTER, () =>
      (listComments as any).run({ documentId: row }),
    );
    expect(comments).toEqual([
      expect.objectContaining({
        thread_id: created.threadId,
        quoted_text: null,
        property_id: fixture.scoreId,
        property_name: "Score",
        property_value: "5",
      }),
    ]);
  });

  it("records no value for a relation, so one reader's linked rows never reach another", async () => {
    const fixture = await seedCollection("relation");
    const [row] = fixture.rows;
    const candidateId = await as(OWNER, async () => {
      // The commenter can't open this Collection or its rows.
      const candidates = await createContentDatabase.run({
        title: "Candidates",
      });
      const read = await getContentDatabase.run({
        databaseId: candidates.database.id,
      });
      if (!("database" in read) || !read.mutationContract)
        throw new Error("Fixture Collection has no mutation contract.");
      const jane = await addDatabaseItem.run({
        target: read.mutationContract.target,
        expectedSchemaRevision: read.mutationContract.schemaRevision,
        idempotencyKey: "comments-relation-candidate",
        title: "Jane Doe",
      });
      const configured = await configureDocumentProperty.run({
        documentId: fixture.documentId,
        databaseId: fixture.databaseId,
        name: "Candidate",
        type: "relation",
        options: { relation: { databaseId: candidates.database.id } },
      });
      const id = configured.properties.find(
        (property) => property.definition.name === "Candidate",
      )!.definition.id;
      await setDocumentProperty.run({
        documentId: row!,
        databaseId: fixture.databaseId,
        propertyId: id,
        value: [jane.receipt.row.documentId],
      });
      return id;
    });
    const created = await as(OWNER, () =>
      (addComment as any).run({
        documentId: row,
        propertyId: candidateId,
        content: "Strong pick",
      }),
    );

    const { comments } = await as(COMMENTER, () =>
      (listComments as any).run({ documentId: row }),
    );
    expect(comments).toEqual([
      expect.objectContaining({
        thread_id: created.threadId,
        property_id: candidateId,
        property_name: "Candidate",
        property_value: null,
      }),
    ]);
    const listed = await as(COMMENTER, () =>
      (listDatabaseComments as any).run({ databaseId: fixture.databaseId }),
    );
    expect(JSON.stringify([comments, listed])).not.toContain("Jane Doe");
  });

  it("rejects a Property that isn't on the Page, and a Property comment with a quote", async () => {
    const fixture = await seedCollection("invalid");
    await expect(
      as(OWNER, () =>
        (addComment as any).run({
          documentId: fixture.rows[0],
          propertyId: "not-a-property",
          content: "Hm",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_property_not_found" });
    await expect(
      as(OWNER, () =>
        (addComment as any).run({
          documentId: fixture.rows[0],
          propertyId: fixture.scoreId,
          quotedText: "Row",
          content: "Hm",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_property_target_conflict" });
  });

  it("counts each row's open threads for people who can read the row, and clears them on resolve", async () => {
    const fixture = await seedCollection("counts");
    const [shared, propertyRow, privateRow] = fixture.rows;
    const text = await as(OWNER, () =>
      (addComment as any).run({
        documentId: shared,
        quotedText: "Row 0",
        content: "Typo here",
      }),
    );
    const first = await as(OWNER, () =>
      (addComment as any).run({
        documentId: propertyRow,
        propertyId: fixture.scoreId,
        content: "Too low",
      }),
    );
    const latest = await as(COMMENTER, () =>
      (addComment as any).run({
        documentId: propertyRow,
        propertyId: fixture.scoreId,
        content: "Agreed",
      }),
    );
    await as(OWNER, () =>
      (addComment as any).run({
        documentId: privateRow,
        quotedText: "Row 2",
        content: "Private note",
      }),
    );

    const owner = await readItems(OWNER, fixture.databaseId);
    expect(owner.get(shared!)?.comments).toEqual({ open: 1, properties: {} });
    expect(owner.get(propertyRow!)?.comments).toEqual({
      open: 2,
      properties: {
        [fixture.scoreId]: { open: 2, latestThreadId: latest.threadId },
      },
    });
    expect(owner.get(privateRow!)?.comments).toEqual({
      open: 1,
      properties: {},
    });

    const commenter = await readItems(COMMENTER, fixture.databaseId);
    expect(commenter.get(shared!)?.comments?.open).toBe(1);
    expect(commenter.get(propertyRow!)?.comments?.open).toBe(2);
    expect(commenter.get(privateRow!)?.comments).toBeUndefined();

    await as(OWNER, () =>
      (updateComment as any).run({
        id: text.id,
        documentId: shared,
        resolved: true,
      }),
    );
    await as(OWNER, () =>
      (updateComment as any).run({
        id: first.id,
        documentId: propertyRow,
        resolved: true,
      }),
    );
    const after = await readItems(COMMENTER, fixture.databaseId);
    expect(after.get(shared!)?.comments).toBeUndefined();
    expect(after.get(propertyRow!)?.comments).toEqual({
      open: 1,
      properties: {
        [fixture.scoreId]: { open: 1, latestThreadId: latest.threadId },
      },
    });
  });

  it("lists every row's threads in one read, limited to rows the caller can read", async () => {
    const fixture = await seedCollection("batch");
    const [shared, propertyRow, privateRow] = fixture.rows;
    const text = await as(OWNER, () =>
      (addComment as any).run({
        documentId: shared,
        quotedText: "Row 0",
        content: "Typo here",
      }),
    );
    await as(COMMENTER, () =>
      (addComment as any).run({
        documentId: shared,
        threadId: text.threadId,
        parentId: text.id,
        content: "Fixed",
      }),
    );
    const property = await as(COMMENTER, () =>
      (addComment as any).run({
        documentId: propertyRow,
        propertyId: fixture.scoreId,
        content: "Too low",
      }),
    );
    const hidden = await as(OWNER, () =>
      (addComment as any).run({
        documentId: privateRow,
        quotedText: "Row 2",
        content: "Private note",
      }),
    );

    const commenterRead = await as(COMMENTER, () =>
      (listDatabaseComments as any).run({ databaseId: fixture.databaseId }),
    );
    expect(commenterRead.truncated).toBe(false);
    expect(commenterRead.threads.map((thread: any) => thread.threadId)).toEqual(
      expect.arrayContaining([text.threadId, property.threadId]),
    );
    expect(commenterRead.threads).toHaveLength(2);
    const byThread = new Map<string, any>(
      commenterRead.threads.map((thread: any) => [thread.threadId, thread]),
    );
    expect(byThread.get(text.threadId)).toMatchObject({
      documentId: shared,
      rowTitle: "Row 0",
      resolved: false,
      target: { kind: "text", quotedText: "Row 0" },
      comments: [
        expect.objectContaining({ content: "Typo here", parentId: null }),
        expect.objectContaining({ content: "Fixed", parentId: text.id }),
      ],
    });
    expect(byThread.get(property.threadId)).toMatchObject({
      documentId: propertyRow,
      path: `/page/${propertyRow}?comment=${property.threadId}`,
      target: {
        kind: "property",
        propertyId: fixture.scoreId,
        propertyName: "Score",
        propertyValue: "7",
      },
    });

    const ownerRead = await as(OWNER, () =>
      (listDatabaseComments as any).run({
        documentId: fixture.documentId,
        limit: 2,
      }),
    );
    expect(ownerRead.truncated).toBe(true);
    expect(ownerRead.threads[0].threadId).toBe(hidden.threadId);
  });
});
