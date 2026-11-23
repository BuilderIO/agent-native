import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ContentDatabaseSourceReadResult } from "./_content-database-source-adapters";

const notion = vi.hoisted(() => ({
  read: vi.fn<() => Promise<ContentDatabaseSourceReadResult>>(),
}));
vi.mock("./_notion-database-source-adapter.js", () => ({
  readNotionDatabaseSource: notion.read,
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `refresh-notion-source-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const DATABASE_ID = "db_notion_refresh";
const DOCUMENT_ID = "doc_notion_refresh";
const SOURCE_ID = "src_notion_refresh";
const DATA_SOURCE = "notion-data-source";
const EARLIER = "2026-11-20T00:00:00.000Z";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let refreshSource: typeof import("./refresh-content-database-source.js").default;

function read(
  rows: Array<[id: string, status: string]>,
  hasMore: boolean,
): ContentDatabaseSourceReadResult {
  return {
    state: "live",
    entries: rows.map(([id, status]) => ({
      id,
      model: DATA_SOURCE,
      title: id,
      urlPath: "",
      updatedAt: EARLIER,
      sourceValues: { status },
    })),
    fields: [],
    fetchedAt: new Date().toISOString(),
    message: hasMore ? "Loaded a bounded Notion snapshot." : null,
    metadata: { provider: "notion", hasMore },
  };
}

function refresh() {
  return runWithRequestContext({ userEmail: OWNER }, () =>
    refreshSource.run({
      databaseId: DATABASE_ID,
      sourceId: SOURCE_ID,
      fullRefresh: true,
    }),
  );
}

async function cachedRows() {
  const rows = await getDb()
    .select({
      sourceRowId: schema.contentDatabaseSourceRows.sourceRowId,
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
    })
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, SOURCE_ID));
  return Object.fromEntries(
    rows.map((row: { sourceRowId: string; sourceValuesJson: string }) => [
      row.sourceRowId,
      (JSON.parse(row.sourceValuesJson) as { status: string }).status,
    ]),
  );
}

async function sourceRow() {
  const [row = null] = await getDb()
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, SOURCE_ID));
  if (!row) throw new Error("No Notion source");
  return row;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  refreshSource = (await import("./refresh-content-database-source.js"))
    .default;

  const db = getDb();
  await db.insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Roadmap",
    createdAt: EARLIER,
    updatedAt: EARLIER,
  });
  await db.insert(schema.contentDatabases).values({
    id: DATABASE_ID,
    ownerEmail: OWNER,
    documentId: DOCUMENT_ID,
    title: "Roadmap",
    createdAt: EARLIER,
    updatedAt: EARLIER,
  });
}, 60_000);

beforeEach(async () => {
  notion.read.mockReset();
  const db = getDb();
  await db
    .delete(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, SOURCE_ID));
  await db
    .delete(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, SOURCE_ID));
  await db.insert(schema.contentDatabaseSources).values({
    id: SOURCE_ID,
    ownerEmail: OWNER,
    databaseId: DATABASE_ID,
    sourceType: "notion-database",
    sourceName: "Roadmap",
    sourceTable: DATA_SOURCE,
    lastRefreshedAt: EARLIER,
    createdAt: EARLIER,
    updatedAt: EARLIER,
  });
  await db.insert(schema.contentDatabaseSourceRows).values(
    ["a", "b", "c"].map((id) => ({
      id: `cached_${id}`,
      ownerEmail: OWNER,
      sourceId: SOURCE_ID,
      databaseItemId: "",
      documentId: "",
      sourceRowId: id,
      sourceQualifiedId: `notion-database://${DATA_SOURCE}/${id}`,
      sourceDisplayKey: id,
      sourceValuesJson: JSON.stringify({ status: "old" }),
      createdAt: EARLIER,
      updatedAt: EARLIER,
    })),
  );
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("refreshing a Notion source", () => {
  it("keeps the cached rows a capped read didn't reach", async () => {
    notion.read.mockResolvedValueOnce(
      read(
        [
          ["a", "new"],
          ["d", "new"],
        ],
        true,
      ),
    );
    const result = await refresh();

    expect(result.summary).toContain("stopped at 2 rows");
    expect(await cachedRows()).toEqual({
      a: "new",
      b: "old",
      c: "old",
      d: "new",
    });
  });

  it("drops rows a complete read no longer has", async () => {
    notion.read.mockResolvedValueOnce(read([["a", "new"]], false));
    await refresh();

    expect(await cachedRows()).toEqual({ a: "new" });
  });

  it("leaves the snapshot to a refresh that is already running", async () => {
    let finishFirst!: (result: ContentDatabaseSourceReadResult) => void;
    notion.read.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );
    const first = refresh();
    await vi.waitFor(() => expect(notion.read).toHaveBeenCalledTimes(1));

    const second = await refresh();
    expect(second.summary).toContain("another refresh in progress");
    expect(notion.read).toHaveBeenCalledTimes(1);

    finishFirst(read([["a", "first"]], false));
    await first;
    expect(await cachedRows()).toEqual({ a: "first" });

    notion.read.mockResolvedValueOnce(read([["a", "third"]], false));
    await refresh();
    expect(await cachedRows()).toEqual({ a: "third" });
  });

  it("keeps a failed read on the source until a refresh works", async () => {
    notion.read.mockRejectedValueOnce(new Error("Notion said no."));
    await expect(refresh()).rejects.toThrow("Notion said no.");

    const failed = await sourceRow();
    expect(failed.syncState).toBe("error");
    expect(failed.lastError).toBe("Notion said no.");
    expect(failed.lastRefreshedAt).toBe(EARLIER);
    expect(await cachedRows()).toEqual({ a: "old", b: "old", c: "old" });

    notion.read.mockResolvedValueOnce(read([["a", "new"]], false));
    await refresh();
    const recovered = await sourceRow();
    expect(recovered.syncState).toBe("linked");
    expect(recovered.lastError).toBe(null);
  });
});
