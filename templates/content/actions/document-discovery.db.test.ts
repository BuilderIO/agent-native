import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-document-discovery-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "discovery-owner@example.com";
const OUTSIDER = "discovery-outsider@example.com";
const PARENT_ID = "bounded-discovery-parent";
const SPACE_ID = "bounded-discovery-space";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listDocuments: typeof import("./list-documents.js").default;
let searchDocuments: typeof import("./search-documents.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listDocuments = (await import("./list-documents.js")).default;
  searchDocuments = (await import("./search-documents.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  const now = new Date().toISOString();
  await getDb().insert(schema.contentSpaces).values({
    id: SPACE_ID,
    name: "Bounded discovery",
    kind: "personal",
    ownerEmail: OWNER,
    orgId: null,
    filesDatabaseId: "bounded-discovery-files",
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.documents).values({
    id: PARENT_ID,
    spaceId: SPACE_ID,
    ownerEmail: OWNER,
    orgId: null,
    parentId: null,
    title: "Discovery parent",
    content: "",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  const documents = Array.from({ length: 205 }, (_, index) => ({
    id: `bounded-discovery-document-${index.toString().padStart(3, "0")}`,
    spaceId: SPACE_ID,
    ownerEmail: OWNER,
    orgId: null,
    parentId: PARENT_ID,
    title: index < 2 ? "Duplicate exact title" : `Bounded document ${index}`,
    description: index === 204 ? "last page marker" : "",
    content: `needle payload ${index}`,
    position: index,
    visibility: "private" as const,
    createdAt: now,
    updatedAt: new Date(Date.parse(now) + index).toISOString(),
  }));
  for (let start = 0; start < documents.length; start += 100) {
    await getDb()
      .insert(schema.documents)
      .values(documents.slice(start, start + 100));
  }
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

describe("bounded document discovery", () => {
  it("returns explicit continuation metadata through a terminal list page", async () => {
    const first = await asUser(OWNER, () =>
      listDocuments.run({ parentId: PARENT_ID, limit: 100, offset: 0 }),
    );
    const second = await asUser(OWNER, () =>
      listDocuments.run({ parentId: PARENT_ID, limit: 100, offset: 100 }),
    );
    const terminal = await asUser(OWNER, () =>
      listDocuments.run({ parentId: PARENT_ID, limit: 100, offset: 200 }),
    );

    expect(first.pagination).toEqual({
      offset: 0,
      limit: 100,
      totalItems: 205,
      returnedItems: 100,
      hasMore: true,
      nextOffset: 100,
    });
    expect(second.pagination.nextOffset).toBe(200);
    expect(terminal.pagination).toEqual({
      offset: 200,
      limit: 100,
      totalItems: 205,
      returnedItems: 5,
      hasMore: false,
      nextOffset: null,
    });
    expect(terminal.documents.at(-1)?.description).toBe("last page marker");
  });

  it("distinguishes zero, one, and multiple exact scoped title matches", async () => {
    const none = await asUser(OWNER, () =>
      searchDocuments.run({
        exactTitle: "No such document",
        parentId: PARENT_ID,
        spaceId: SPACE_ID,
        documentType: "page",
        limit: 10,
        offset: 0,
      }),
    );
    const one = await asUser(OWNER, () =>
      searchDocuments.run({
        exactTitle: "Bounded document 204",
        parentId: PARENT_ID,
        spaceId: SPACE_ID,
        documentType: "page",
        limit: 10,
        offset: 0,
      }),
    );
    const multiple = await asUser(OWNER, () =>
      searchDocuments.run({
        exactTitle: "Duplicate exact title",
        parentId: PARENT_ID,
        spaceId: SPACE_ID,
        documentType: "page",
        limit: 1,
        offset: 0,
      }),
    );

    expect(none.pagination).toMatchObject({
      totalItems: 0,
      returnedItems: 0,
      hasMore: false,
      nextOffset: null,
    });
    expect(one.pagination).toMatchObject({
      totalItems: 1,
      returnedItems: 1,
      hasMore: false,
      nextOffset: null,
    });
    expect(multiple.pagination).toMatchObject({
      totalItems: 2,
      returnedItems: 1,
      hasMore: true,
      nextOffset: 1,
    });
  });

  it("paginates body search and suppresses the private corpus for an outsider", async () => {
    const ownerPage = await asUser(OWNER, () =>
      searchDocuments.run({
        query: "needle payload",
        parentId: PARENT_ID,
        limit: 200,
        offset: 0,
      }),
    );
    const outsiderPage = await asUser(OUTSIDER, () =>
      searchDocuments.run({
        query: "needle payload",
        parentId: PARENT_ID,
        limit: 200,
        offset: 0,
      }),
    );

    expect(ownerPage.pagination).toMatchObject({
      totalItems: 205,
      returnedItems: 200,
      hasMore: true,
      nextOffset: 200,
    });
    expect(outsiderPage).toMatchObject({
      documents: [],
      pagination: {
        totalItems: 0,
        returnedItems: 0,
        hasMore: false,
        nextOffset: null,
      },
    });
  });
});
