import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-documents-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "search-documents-owner@example.com";
const CASE_PROBE_ID = "case-probe-zeta";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("./search-documents.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  searchDocuments = (await import("./search-documents.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: CASE_PROBE_ID,
    ownerEmail: OWNER,
    orgId: null,
    parentId: null,
    title: "Case Probe Zeta",
    content:
      "Introductory filler. sprocket-quasar-beacon marker appears mid-body.",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("search-documents free-text case sensitivity", () => {
  it("matches a mixed-case title from lowercase and uppercase queries", async () => {
    const lowercase = await asUser(OWNER, () =>
      searchDocuments.run({ query: "case probe zeta", limit: 10, offset: 0 }),
    );
    const uppercase = await asUser(OWNER, () =>
      searchDocuments.run({ query: "CASE PROBE ZETA", limit: 10, offset: 0 }),
    );

    expect(lowercase.documents.map((doc) => doc.id)).toEqual([CASE_PROBE_ID]);
    expect(lowercase.pagination.totalItems).toBe(1);
    expect(uppercase.documents.map((doc) => doc.id)).toEqual([CASE_PROBE_ID]);
    expect(uppercase.pagination.totalItems).toBe(1);
  });

  it("matches a mixed-case body with an uppercase query", async () => {
    const result = await asUser(OWNER, () =>
      searchDocuments.run({
        query: "SPROCKET-QUASAR-BEACON",
        limit: 10,
        offset: 0,
      }),
    );

    expect(result.documents.map((doc) => doc.id)).toEqual([CASE_PROBE_ID]);
    expect(result.documents[0]?.snippet).toContain(
      "sprocket-quasar-beacon marker",
    );
  });

  it("keeps exactTitle matching case-sensitive", async () => {
    const wrongCase = await asUser(OWNER, () =>
      searchDocuments.run({
        exactTitle: "case probe zeta",
        limit: 10,
        offset: 0,
      }),
    );
    const exactCase = await asUser(OWNER, () =>
      searchDocuments.run({
        exactTitle: "Case Probe Zeta",
        limit: 10,
        offset: 0,
      }),
    );

    expect(wrongCase.pagination).toMatchObject({
      totalItems: 0,
      returnedItems: 0,
      hasMore: false,
      nextOffset: null,
    });
    expect(exactCase.documents.map((doc) => doc.id)).toEqual([CASE_PROBE_ID]);
  });
});
