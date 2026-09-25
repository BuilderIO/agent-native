import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-lifecycle-qa-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "search-lifecycle-owner@example.com";
const OUTSIDER = "search-lifecycle-outsider@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("./search-documents.js").default;
let updateDocument: typeof import("./update-document.js").default;
let deleteDocument: typeof import("./delete-document.js").default;
let restoreDocument: typeof import("./restore-document.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

const ids = (result: { documents: Array<{ id: string }> }) =>
  result.documents.map((document) => document.id);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  searchDocuments = (await import("./search-documents.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  deleteDocument = (await import("./delete-document.js")).default;
  restoreDocument = (await import("./restore-document.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("Content search lifecycle QA", () => {
  it("QA-06 closes access, hidden, Trash, and deleted-collection leaks", async () => {
    await getDb()
      .insert(schema.documents)
      .values([
        {
          id: "qa06-visible",
          ownerEmail: OWNER,
          title: "Closure needle visible",
        },
        {
          id: "qa06-private-outsider",
          ownerEmail: OUTSIDER,
          title: "Closure needle private",
        },
        {
          id: "qa06-hidden",
          ownerEmail: OWNER,
          title: "Closure needle hidden",
          hideFromSearch: 1,
        },
        {
          id: "qa06-trashed",
          ownerEmail: OWNER,
          title: "Closure needle trashed",
          trashedAt: "2026-09-21T01:00:00.000Z",
          trashRootId: "qa06-trashed",
        },
        {
          id: "qa06-deleted-database",
          ownerEmail: OWNER,
          title: "Closure needle deleted database",
        },
        {
          id: "qa06-deleted-row",
          ownerEmail: OWNER,
          title: "Closure needle deleted row",
        },
      ]);
    await getDb().insert(schema.contentDatabases).values({
      id: "qa06-database",
      ownerEmail: OWNER,
      documentId: "qa06-deleted-database",
      title: "Closure needle deleted database",
      deletedAt: "2026-09-21T01:00:00.000Z",
    });
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "qa06-item",
      ownerEmail: OWNER,
      databaseId: "qa06-database",
      documentId: "qa06-deleted-row",
    });

    const owner = await asUser(OWNER, () =>
      searchDocuments.run({ query: "Closure needle", limit: 20, offset: 0 }),
    );
    const outsider = await asUser(OUTSIDER, () =>
      searchDocuments.run({ query: "Closure needle", limit: 20, offset: 0 }),
    );

    expect(ids(owner)).toEqual(["qa06-visible"]);
    expect(owner.pagination.totalItems).toBe(1);
    expect(ids(outsider)).toEqual(["qa06-private-outsider"]);
    expect(JSON.stringify(outsider)).not.toContain("qa06-visible");
  });

  it("QA-07 traverses every bounded page once and reports exact terminal metadata", async () => {
    const expected = Array.from(
      { length: 23 },
      (_, index) => `qa07-${index.toString().padStart(2, "0")}`,
    );
    await getDb()
      .insert(schema.documents)
      .values(
        expected.map((id, index) => ({
          id,
          ownerEmail: OWNER,
          title: `Traversal needle ${index}`,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        })),
      );

    const seen: string[] = [];
    let offset = 0;
    do {
      const page = await asUser(OWNER, () =>
        searchDocuments.run({
          query: "Traversal needle",
          searchFields: "title",
          limit: 7,
          offset,
        }),
      );
      expect(page.pagination.totalItems).toBe(23);
      expect(page.pagination.returnedItems).toBe(page.documents.length);
      seen.push(...ids(page));
      if (!page.pagination.hasMore) {
        expect(page.pagination).toMatchObject({
          offset: 21,
          returnedItems: 2,
          nextOffset: null,
        });
        break;
      }
      offset = page.pagination.nextOffset!;
    } while (true);

    expect(new Set(seen).size).toBe(23);
    expect([...seen].sort()).toEqual(expected);
    const pastEnd = await asUser(OWNER, () =>
      searchDocuments.run({
        query: "Traversal needle",
        searchFields: "title",
        limit: 7,
        offset: 28,
      }),
    );
    expect(pastEnd).toMatchObject({
      documents: [],
      pagination: {
        offset: 28,
        limit: 7,
        totalItems: 23,
        returnedItems: 0,
        hasMore: false,
        nextOffset: null,
      },
    });
  });

  it("QA-08 keeps duplicate titles with equal timestamps in stable id order", async () => {
    const timestamp = "2026-09-21T12:00:00.000Z";
    await getDb()
      .insert(schema.documents)
      .values([
        {
          id: "qa08-c",
          ownerEmail: OWNER,
          title: "Stable duplicate needle",
          updatedAt: timestamp,
        },
        {
          id: "qa08-a",
          ownerEmail: OWNER,
          title: "Stable duplicate needle",
          updatedAt: timestamp,
        },
        {
          id: "qa08-b",
          ownerEmail: OWNER,
          title: "Stable duplicate needle",
          updatedAt: timestamp,
        },
      ]);

    const first = await asUser(OWNER, () =>
      searchDocuments.run({
        query: "Stable duplicate needle",
        limit: 2,
        offset: 0,
      }),
    );
    const second = await asUser(OWNER, () =>
      searchDocuments.run({
        query: "Stable duplicate needle",
        limit: 2,
        offset: 2,
      }),
    );
    const repeated = await asUser(OWNER, () =>
      searchDocuments.run({
        query: "Stable duplicate needle",
        limit: 3,
        offset: 0,
      }),
    );

    expect([...ids(first), ...ids(second)]).toEqual([
      "qa08-a",
      "qa08-b",
      "qa08-c",
    ]);
    expect(ids(repeated)).toEqual(["qa08-a", "qa08-b", "qa08-c"]);
  });

  it("QA-09 reflects rename, body edit, Trash, and restore through actions", async () => {
    await getDb().insert(schema.documents).values({
      id: "qa09-lifecycle",
      ownerEmail: OWNER,
      title: "Lifecycle original",
      content: "Initial prose",
    });

    await asUser(OWNER, () =>
      updateDocument.run({
        id: "qa09-lifecycle",
        title: "Lifecycle renamed",
        content: "Body mutation needle",
      }),
    );
    expect(
      ids(
        await asUser(OWNER, () =>
          searchDocuments.run({
            query: "Lifecycle renamed",
            limit: 10,
            offset: 0,
          }),
        ),
      ),
    ).toEqual(["qa09-lifecycle"]);
    expect(
      ids(
        await asUser(OWNER, () =>
          searchDocuments.run({
            query: "Body mutation needle",
            limit: 10,
            offset: 0,
          }),
        ),
      ),
    ).toEqual(["qa09-lifecycle"]);
    expect(
      ids(
        await asUser(OWNER, () =>
          searchDocuments.run({
            query: "Lifecycle original",
            limit: 10,
            offset: 0,
          }),
        ),
      ),
    ).toEqual([]);

    await asUser(OWNER, () => deleteDocument.run({ id: "qa09-lifecycle" }));
    expect(
      ids(
        await asUser(OWNER, () =>
          searchDocuments.run({
            query: "Body mutation needle",
            limit: 10,
            offset: 0,
          }),
        ),
      ),
    ).toEqual([]);

    await asUser(OWNER, () => restoreDocument.run({ id: "qa09-lifecycle" }));
    expect(
      ids(
        await asUser(OWNER, () =>
          searchDocuments.run({
            query: "Body mutation needle",
            limit: 10,
            offset: 0,
          }),
        ),
      ),
    ).toEqual(["qa09-lifecycle"]);
  });
});
