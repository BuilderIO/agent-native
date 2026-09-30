import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Real PGlite behind getDbExec and Drizzle: triggers, the change feed, the
// indexer, and the query SQL all run their genuine statements.

type Client = typeof import("../db/client.js");
type Search = typeof import("./index.js");
type Feed = typeof import("../resource-changes/store.js");

let client: Client;
let search: Search;
let feed: Feed;
let db: any;
let notes: any;
let registration: import("./registry.js").SearchableResourceRegistration;
let drizzle: typeof import("drizzle-orm");

const exec = () => client.getDbExec();

async function run(sql: string, args: unknown[] = []) {
  return exec().execute({ sql, args });
}

async function insertNote(id: string, title: string, body = "", summary = "") {
  await run(
    `INSERT INTO notes (id, title, summary, body, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, title, summary, body, `2026-01-0${(id.length % 9) + 1}T00:00:00.000Z`],
  );
}

async function searchIds(
  text: string,
  options: { fields?: "all" | "title" } = {},
): Promise<string[]> {
  const indexed = search.indexedSearchSql({
    registration,
    query: search.parseSearchQuery(text),
    fields: options.fields,
  });
  const rows = await db
    .select({ id: notes.id })
    .from(notes)
    .innerJoin(indexed.join, indexed.on)
    .where(indexed.match)
    .orderBy(...indexed.orderBy, drizzle.asc(notes.id));
  return rows.map((row: { id: string }) => row.id);
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  client = await import("../db/client.js");
  drizzle = await import("drizzle-orm");
  const { pgTable, text } = await import("drizzle-orm/pg-core");
  const { createGetDb } = await import("../db/create-get-db.js");
  notes = pgTable("notes", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    body: text("body").notNull(),
    updatedAt: text("updated_at").notNull(),
  });
  db = createGetDb({ notes })();
  search = await import("./index.js");
  feed = await import("../resource-changes/store.js");

  await run(
    `CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`,
  );
  registration = search.registerSearchableResource({
    app: "notes-app",
    type: "note",
    table: notes,
    idColumn: notes.id,
    version: 1,
    load: async (ids) => {
      const rows = await db
        .select()
        .from(notes)
        .where(drizzle.inArray(notes.id, ids));
      return rows.map((row: any) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        body: row.body,
        modifiedAt: row.updatedAt,
      }));
    },
  });
});

afterAll(async () => {
  search.unregisterSearchableResource("notes-app", "note");
  await client.closeDbExec();
  vi.unstubAllEnvs();
});

const noteFeed = {
  consumer: "search",
  app: "notes-app",
  resourceType: "note",
} as const;

async function pending() {
  const { rows } = await run(
    `SELECT resource_id, reason, seq::text AS seq FROM app_resource_changes WHERE consumer = 'search' AND app = 'notes-app' ORDER BY resource_id`,
  );
  return rows.map((row: any) => ({
    id: String(row.resource_id),
    reason: String(row.reason),
    seq: String(row.seq),
  }));
}

describe("before change capture is installed", () => {
  it("reports that the index can't answer, instead of serving stale results", async () => {
    await insertNote("early", "Written before the migration");
    const status = await search.prepareSearchIndex(registration, {
      budgetMs: 1_000,
    });
    expect(status).toEqual({ ready: false, reason: "capture-missing" });
  });
});

describe("the search index", () => {
  beforeAll(async () => {
    const migration = search.searchIndexMigration(registration, {
      version: 1,
      name: "search-index-notes",
    });
    await migration.run!(exec());
    search.resetSearchIndexRuntime();
  });

  beforeEach(() => {
    search.resetSearchIndexRuntime();
  });

  it("builds from existing rows on first use, then answers", async () => {
    const first = await search.prepareSearchIndex(registration, {
      budgetMs: 5_000,
    });
    expect(first).toEqual({ ready: true });
    expect(await searchIds("migration")).toEqual(["early"]);
    expect(await pending()).toEqual([]);
  });

  it("captures inserts, updates, and deletes in the writer's transaction", async () => {
    await insertNote("a", "Alpha");
    const [inserted] = await pending();
    expect(inserted).toMatchObject({ id: "a", reason: "insert" });

    await run(`UPDATE notes SET title = 'Alpha two' WHERE id = 'a'`);
    const [updated] = await pending();
    expect(updated!.reason).toBe("update");
    expect(BigInt(updated!.seq)).toBeGreaterThan(BigInt(inserted!.seq));

    // An update that changes nothing records nothing new.
    await run(`UPDATE notes SET title = 'Alpha two' WHERE id = 'a'`);
    expect((await pending())[0]!.seq).toBe(updated!.seq);

    await run(`DELETE FROM notes WHERE id = 'a'`);
    expect((await pending())[0]!.reason).toBe("delete");

    // A rolled-back write records nothing.
    await expect(
      exec().transaction!(async (tx) => {
        await tx.execute({
          sql: `INSERT INTO notes (id, title, updated_at) VALUES ('ghost', 'Ghost', '2026-01-01')`,
        });
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    expect((await pending()).map((row) => row.id)).toEqual(["a"]);

    expect(await search.prepareSearchIndex(registration)).toEqual({
      ready: true,
    });
    const { rows } = await run(
      `SELECT resource_id FROM search_resources WHERE app = 'notes-app' AND resource_id = 'a'`,
    );
    expect(rows).toEqual([]);
  });

  it("keeps a change recorded while it was being processed", async () => {
    await insertNote("b", "Bravo");
    const claimed = await feed.claimResourceChanges(exec(), noteFeed, 10);
    expect(claimed.map((change) => change.resourceId)).toEqual(["b"]);

    await run(`UPDATE notes SET body = 'edited meanwhile' WHERE id = 'b'`);
    await feed.completeResourceChanges(exec(), noteFeed, claimed);
    const [left] = await pending();
    expect(left!.id).toBe("b");
    expect(BigInt(left!.seq)).toBeGreaterThan(BigInt(claimed[0]!.seq));

    expect(await search.prepareSearchIndex(registration)).toEqual({
      ready: true,
    });
    expect(await searchIds("meanwhile")).toEqual(["b"]);
  });

  it("never claims more changes than asked", async () => {
    for (let index = 0; index < 120; index += 1) {
      await insertNote(`bulk-${index}`, `Bulk note ${index}`);
    }
    const claimed = await feed.claimResourceChanges(exec(), noteFeed, 50);
    expect(claimed).toHaveLength(50);
    await feed.completeResourceChanges(exec(), noteFeed, claimed);
    await run(`DELETE FROM notes WHERE id LIKE 'bulk-%'`);
    expect(await search.prepareSearchIndex(registration)).toEqual({
      ready: true,
    });
  });

  it("reports a backlog it couldn't process instead of answering stale", async () => {
    await insertNote("c", "Charlie");
    expect(
      await search.prepareSearchIndex(registration, { budgetMs: 0 }),
    ).toEqual({ ready: false, reason: "backlog" });
    expect(await search.prepareSearchIndex(registration)).toEqual({
      ready: true,
    });
  });

  describe("matching and ranking", () => {
    beforeAll(async () => {
      await run(`DELETE FROM notes`);
      await insertNote("p1", "Task Priorities");
      await insertNote(
        "p2",
        "Weekly notes",
        "We discussed task priorities and prioritization.",
      );
      await insertNote("p3", "Priorities for Q3");
      await insertNote("p4", "Roadmap", "", "Covers product priorities");
      await insertNote(
        "code",
        "Engineering notes",
        "Call searchIndexState from the snake_case_helper at https://docs.example.com/api/v2",
      );
      await insertNote(
        "ja",
        "オンボーディングガイド",
        "新しいエンジニアのための手順",
      );
      await insertNote(
        "phrase",
        "Incident review",
        "webhook retries created duplicate charges",
      );
      await insertNote(
        "scattered",
        "Delivery notes",
        "webhook delivery retries; later, created duplicate charges",
      );
      await insertNote("report", "Quarterly report", "the report is done");
      await insertNote(
        "repetitive",
        "Loop log",
        `${"tick tock ".repeat(300)}bell`,
      );
      await search.prepareSearchIndex(registration, { budgetMs: 5_000 });
    });

    it("ranks exact, prefix, word-prefix, substring, then summary matches", async () => {
      expect(await searchIds("task priorities")).toEqual(["p1", "p2"]);
      expect(await searchIds("priorities")).toEqual(["p3", "p1", "p4", "p2"]);
    });

    it("matches titles and summaries mid-word, bodies only at word starts", async () => {
      expect(await searchIds("prio")).toEqual(["p3", "p1", "p4", "p2"]);
      // p2 says "priorities" only in its body, so a mid-word piece misses it.
      expect(await searchIds("iorit")).toEqual(["p1", "p3", "p4"]);
      expect(await searchIds("eport")).toEqual(["report"]);
      expect(await searchIds("epor", { fields: "title" })).toEqual(["report"]);
    });

    it("finds camelCase, snake_case, and URL parts in bodies", async () => {
      expect(await searchIds("searchIndexState")).toEqual(["code"]);
      expect(await searchIds("index state")).toEqual(["code"]);
      expect(await searchIds("snake_case")).toEqual(["code"]);
      expect(await searchIds("docs.example.com/api")).toEqual(["code"]);
    });

    it("finds Japanese text by substring in titles and bodies", async () => {
      expect(await searchIds("オンボーディングガイド")).toEqual(["ja"]);
      expect(await searchIds("エンジニア")).toEqual(["ja"]);
      expect(await searchIds("ジニアの")).toEqual(["ja"]);
    });

    it("ranks a body phrase above scattered words", async () => {
      expect(
        await searchIds("webhook retries created duplicate charges"),
      ).toEqual(["phrase", "scattered"]);
    });

    it("still finds a phrase in a document too repetitive for exact positions", async () => {
      // Postgres keeps 255 positions per word, so a phrase deep in this
      // body can't be matched by position; every word being present is
      // enough for such a document.
      expect(await searchIds(`"${"tick tock ".repeat(290)}bell"`)).toEqual([
        "repetitive",
      ]);
      expect(await searchIds(`"tock bell"`)).toEqual(["repetitive"]);
      expect(await searchIds(`"bell tick"`)).toEqual(["repetitive"]);
      expect(await searchIds(`"retries bell"`)).toEqual([]);
    });

    it("supports OR, negation, phrases, and intitle", async () => {
      expect(await searchIds("roadmap OR engineering")).toEqual(["p4", "code"]);
      expect(await searchIds("priorities -task")).toEqual(["p3", "p4"]);
      expect(await searchIds('"created duplicate"')).toEqual([
        "phrase",
        "scattered",
      ]);
      expect(await searchIds('"retries created"')).toEqual(["phrase"]);
      expect(await searchIds("intitle:priorities")).toEqual(["p3", "p1"]);
    });

    it("matches titles only when asked", async () => {
      expect(await searchIds("priorities", { fields: "title" })).toEqual([
        "p3",
        "p1",
      ]);
    });

    it("treats operator characters in input as text", async () => {
      expect(await searchIds("priorities & !(:*")).toEqual([
        "p3",
        "p1",
        "p4",
        "p2",
      ]);
    });
  });

  describe("a new registration version", () => {
    it("rebuilds, and an older process defers to it", async () => {
      const v2 = { ...registration, version: 2 };
      search.resetSearchIndexRuntime();
      expect(await search.prepareSearchIndex(v2, { budgetMs: 0 })).toEqual({
        ready: false,
        reason: "rebuilding",
      });
      search.resetSearchIndexRuntime();
      expect(await search.prepareSearchIndex(registration)).toEqual({
        ready: false,
        reason: "outdated-registration",
      });
      search.resetSearchIndexRuntime();
      expect(await search.prepareSearchIndex(v2, { budgetMs: 5_000 })).toEqual({
        ready: true,
      });
      const { rows } = await run(
        `SELECT DISTINCT index_version FROM search_resources WHERE app = 'notes-app'`,
      );
      expect(rows.map((row: any) => Number(row.index_version))).toEqual([2]);
    });
  });
});
