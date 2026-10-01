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
type Indexer = typeof import("./indexer.js");

let client: Client;
let search: Search;
let feed: Feed;
let indexer: Indexer;
let db: any;
let notes: any;
let registration: import("./registry.js").SearchableResourceRegistration;
let drizzle: typeof import("drizzle-orm");
let pgCore: typeof import("drizzle-orm/pg-core");

const exec = () => client.getDbExec();

/** Drains the whole backlog: tests never race the default 100 ms budget. */
function prepareFully(
  target: import("./registry.js").SearchableResourceRegistration = registration,
) {
  return search.prepareSearchIndex(target, { budgetMs: 10_000 });
}

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
  pgCore = await import("drizzle-orm/pg-core");
  const { pgTable, text } = pgCore;
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
  indexer = await import("./indexer.js");

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
    const first = await prepareFully();
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

    expect(await prepareFully()).toEqual({
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

    expect(await prepareFully()).toEqual({
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
    expect(await prepareFully()).toEqual({
      ready: true,
    });
  });

  it("reports a backlog it couldn't process instead of answering stale", async () => {
    await insertNote("c", "Charlie");
    expect(
      await search.prepareSearchIndex(registration, { budgetMs: 0 }),
    ).toEqual({ ready: false, reason: "backlog" });
    expect(await prepareFully()).toEqual({
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
      await prepareFully();
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
      // The body's last character, which starts no character pair.
      expect(await searchIds("順")).toEqual(["ja"]);
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
      // Every word must still be in one field: "log" is the title's.
      expect(await searchIds(`"log tick"`)).toEqual([]);
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

    it("doesn't match a phrase across two fields", async () => {
      // p4's title is "Roadmap" and its description starts "Covers".
      expect(await searchIds('"roadmap covers"')).toEqual([]);
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
      // A drain with no time left starts the rebuild and processes nothing.
      expect(await indexer.drainSearchIndex(v2, Date.now())).toEqual({
        ready: false,
        reason: "rebuilding",
      });
      search.resetSearchIndexRuntime();
      expect(await prepareFully()).toEqual({
        ready: false,
        reason: "outdated-registration",
      });
      search.resetSearchIndexRuntime();
      expect(await prepareFully(v2)).toEqual({
        ready: true,
      });
      const { rows } = await run(
        `SELECT DISTINCT index_version FROM search_resources WHERE app = 'notes-app'`,
      );
      expect(rows.map((row: any) => Number(row.index_version))).toEqual([2]);
    });
  });
});

// The cases below each get their own table and registration, so feed and
// index state never leak between them.

function isolatedTable(name: string) {
  const { pgTable, text } = pgCore;
  return pgTable(name, {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
  });
}

async function isolatedRegistration(
  type: string,
  options: { beforeLoad?: (ids: string[]) => Promise<void> | void } = {},
) {
  const tableName = `search_${type.replace(/-/g, "_")}`;
  await run(
    `CREATE TABLE ${tableName} (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '')`,
  );
  const table = isolatedTable(tableName);
  const registered = search.registerSearchableResource({
    app: "isolated",
    type,
    table,
    idColumn: table.id,
    version: 1,
    load: async (ids) => {
      await options.beforeLoad?.(ids);
      const rows = await db
        .select()
        .from(table)
        .where(drizzle.inArray(table.id, ids));
      return rows.map((row: any) => ({
        id: row.id,
        title: row.title,
        body: row.body,
      }));
    },
  });
  await search.searchIndexMigration(registered, {
    version: 1,
    name: `capture-${type}`,
  }).run!(exec());
  return { registered, tableName };
}

/** Each indexed row's version and the version its content hash names. */
async function indexedVersions(type: string) {
  const { rows } = await run(
    `SELECT DISTINCT index_version, split_part(content_hash, ':', 1) AS hashed
     FROM search_resources WHERE app = 'isolated' AND resource_type = ? ORDER BY 1`,
    [type],
  );
  return rows.map((row: any) => `${row.index_version}/${row.hashed}`);
}

async function indexedIds(type: string) {
  const { rows } = await run(
    `SELECT resource_id FROM search_resources WHERE app = 'isolated' AND resource_type = ? ORDER BY 1`,
    [type],
  );
  return rows.map((row: any) => String(row.resource_id));
}

/** Makes every backed-off change claimable now. */
async function skipBackoff(type: string) {
  await run(
    `UPDATE app_resource_changes SET available_at = now() WHERE app = 'isolated' AND resource_type = ?`,
    [type],
  );
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

describe("older deploys during a rebuild", () => {
  beforeEach(() => {
    search.resetSearchIndexRuntime();
  });

  it("can't consume the newer version's rebuild from a warm process", async () => {
    const { registered: v1, tableName } = await isolatedRegistration("warm");
    for (let index = 0; index < 5; index += 1) {
      await run(`INSERT INTO ${tableName} (id, title) VALUES (?, ?)`, [
        `d${index}`,
        `Doc ${index}`,
      ]);
    }
    const v2 = { ...v1, version: 2 };
    // One process throughout: v1 having been ready must not carry over.
    expect(await prepareFully(v1)).toEqual({ ready: true });
    expect(await indexer.drainSearchIndex(v2, Date.now())).toEqual({
      ready: false,
      reason: "rebuilding",
    });
    expect(await prepareFully(v1)).toEqual({
      ready: false,
      reason: "outdated-registration",
    });
    expect(await indexer.drainSearchIndex(v1, Date.now() + 10_000)).toEqual({
      ready: false,
      reason: "outdated-registration",
    });
    expect(await prepareFully(v2)).toEqual({ ready: true });
    expect(await indexedVersions("warm")).toEqual(["2/v2"]);
    expect(await indexedIds("warm")).toHaveLength(5);
  });

  it("discard a batch an older process was indexing when the version rose", async () => {
    let held: {
      loading: ReturnType<typeof gate>;
      release: ReturnType<typeof gate>;
    } | null = null;
    const { registered: v1, tableName } = await isolatedRegistration(
      "in-flight",
      {
        beforeLoad: async () => {
          if (!held) return;
          held.loading.open();
          await held.release.opened;
        },
      },
    );
    await run(`INSERT INTO ${tableName} (id, title) VALUES ('a', 'Alpha')`);
    expect(await prepareFully(v1)).toEqual({ ready: true });

    await run(`INSERT INTO ${tableName} (id, title) VALUES ('b', 'Bravo')`);
    const hold = { loading: gate(), release: gate() };
    held = hold;
    const older = indexer.drainSearchIndex(v1, Date.now() + 10_000);
    await hold.loading.opened;
    // A separate process deploys v2 while v1 holds the claimed batch.
    held = null;
    search.resetSearchIndexRuntime();
    const v2 = { ...v1, version: 2 };
    await indexer.drainSearchIndex(v2, Date.now());
    hold.release.open();
    expect(await older).toEqual({
      ready: false,
      reason: "outdated-registration",
    });

    expect(await prepareFully(v2)).toEqual({ ready: true });
    expect(await indexedVersions("in-flight")).toEqual(["2/v2"]);
    expect(await indexedIds("in-flight")).toEqual(["a", "b"]);
  });
});

describe("a change that keeps failing", () => {
  beforeEach(() => {
    search.resetSearchIndexRuntime();
  });

  it("holds back only itself, and keeps search on the fallback until it succeeds", async () => {
    const { registered, tableName } = await isolatedRegistration("poison", {
      beforeLoad: async (ids) => {
        const { rows } = await run(
          `SELECT id FROM search_poison WHERE title = 'bad' AND id IN (${ids.map(() => "?").join(", ")})`,
          ids,
        );
        if (rows.length) throw new Error("this document can't be indexed");
      },
    });
    for (const [id, title] of [
      ["ok-1", "Fine"],
      ["ok-2", "Also fine"],
      ["poison", "bad"],
    ]) {
      await run(`INSERT INTO ${tableName} (id, title) VALUES (?, ?)`, [
        id,
        title,
      ]);
    }
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const statuses: (string | undefined)[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const status = await prepareFully(registered);
        statuses.push(status.ready ? "ready" : status.reason);
        await skipBackoff("poison");
      }
      // The first build can't finish while a document it queued fails.
      // Once that document fails its last attempt, search says so.
      expect(statuses).toEqual([
        "rebuilding",
        "rebuilding",
        "rebuilding",
        "rebuilding",
        "rebuilding",
        "rebuilding",
      ]);
      expect(await indexedIds("poison")).toEqual(["ok-1", "ok-2"]);
      const { rows: failing } = await run(
        `SELECT resource_id FROM app_resource_changes WHERE app = 'isolated' AND resource_type = 'poison' AND failed_at IS NOT NULL`,
      );
      expect(failing.map((row: any) => row.resource_id)).toEqual(["poison"]);
      expect(
        errors.mock.calls.some((call) =>
          String(call[0]).includes("keep failing to index"),
        ),
      ).toBe(true);

      // Fixing the document is a write, which starts its change fresh.
      await run(
        `UPDATE ${tableName} SET title = 'Repaired' WHERE id = 'poison'`,
      );
      expect(await prepareFully(registered)).toEqual({ ready: true });

      // After the first build, a failing change is reported as such.
      await run(`UPDATE ${tableName} SET title = 'bad' WHERE id = 'ok-1'`);
      await run(`INSERT INTO ${tableName} (id, title) VALUES ('ok-3', 'New')`);
      const later: (string | undefined)[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const status = await prepareFully(registered);
        later.push(status.ready ? "ready" : status.reason);
        await skipBackoff("poison");
      }
      expect(later).toEqual([
        "backlog",
        "backlog",
        "backlog",
        "backlog",
        "failed-changes",
        "failed-changes",
      ]);
      expect(await indexedIds("poison")).toEqual([
        "ok-1",
        "ok-2",
        "ok-3",
        "poison",
      ]);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it("isn't caused by a document with too many distinct words", async () => {
    const words = Array.from(
      { length: 130_000 },
      (_, index) => `w${index.toString(36).padStart(8, "x")}`,
    );
    const vector = search.buildSearchVector([
      { text: words.join(" "), weight: "C" },
    ]);
    const { rows } = await run(`SELECT length(?::tsvector) AS lexemes`, [
      vector.literal,
    ]);
    expect(Number(rows[0]!.lexemes)).toBeGreaterThan(50_000);
    expect(vector.positionsComplete).toBe(false);
  });
});

describe("a search's budget", () => {
  beforeEach(() => {
    search.resetSearchIndexRuntime();
  });

  it("bounds a search that joins a long drain", async () => {
    let held: {
      loading: ReturnType<typeof gate>;
      release: ReturnType<typeof gate>;
    } | null = null;
    const { registered, tableName } = await isolatedRegistration("joined", {
      beforeLoad: async () => {
        if (!held) return;
        held.loading.open();
        await held.release.opened;
      },
    });
    expect(await prepareFully(registered)).toEqual({ ready: true });
    await run(`INSERT INTO ${tableName} (id, title) VALUES ('late', 'Late')`);
    const hold = { loading: gate(), release: gate() };
    held = hold;
    const sweep = indexer.drainAllSearchIndexes(Date.now() + 20_000);
    try {
      await hold.loading.opened;
      const started = Date.now();
      const status = await search.prepareSearchIndex(registered, {
        budgetMs: 50,
      });
      expect(Date.now() - started).toBeLessThan(500);
      expect(status).toEqual({ ready: false, reason: "backlog" });
    } finally {
      held = null;
      hold.release.open();
      await sweep;
    }
    expect(await prepareFully(registered)).toEqual({ ready: true });
  });

  it("bounds a search's own drain", async () => {
    let delayMs = 0;
    const { registered, tableName } = await isolatedRegistration("own", {
      beforeLoad: () => new Promise((resolve) => setTimeout(resolve, delayMs)),
    });
    expect(await prepareFully(registered)).toEqual({ ready: true });
    await run(`INSERT INTO ${tableName} (id, title) VALUES ('slow', 'Slow')`);
    delayMs = 600;
    const started = Date.now();
    const status = await search.prepareSearchIndex(registered, {
      budgetMs: 50,
    });
    expect(Date.now() - started).toBeLessThan(400);
    expect(status).toEqual({ ready: false, reason: "backlog" });
    // The drain finishes its batch in the background.
    delayMs = 0;
    await indexer.drainSearchIndex(registered, Date.now() + 10_000);
    expect(await prepareFully(registered)).toEqual({ ready: true });
  });

  it("can be unlimited", async () => {
    let delayMs = 0;
    const { registered, tableName } = await isolatedRegistration("unlimited", {
      beforeLoad: () => new Promise((resolve) => setTimeout(resolve, delayMs)),
    });
    expect(await prepareFully(registered)).toEqual({ ready: true });
    await run(`INSERT INTO ${tableName} (id, title) VALUES ('new', 'New')`);
    delayMs = 50;
    expect(
      await search.prepareSearchIndex(registered, {
        budgetMs: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ ready: true });
  });

  it("of zero reports pending changes without indexing them", async () => {
    const { registered, tableName } = await isolatedRegistration("zero");
    expect(await prepareFully(registered)).toEqual({ ready: true });
    await run(`INSERT INTO ${tableName} (id, title) VALUES ('new', 'New')`);
    expect(
      await search.prepareSearchIndex(registered, { budgetMs: 0 }),
    ).toEqual({ ready: false, reason: "backlog" });
    const { rows } = await run(
      `SELECT attempts FROM app_resource_changes WHERE app = 'isolated' AND resource_type = 'zero'`,
    );
    expect(rows.map((row: any) => Number(row.attempts))).toEqual([0]);
  });
});

describe("change capture", () => {
  it("gives every source its own trigger names", async () => {
    const names = (app: string, table: string, resourceType: string) =>
      feed.resourceChangeTriggerNames({
        app,
        table,
        resourceType,
        idColumn: "id",
      }).function;
    const long = "a".repeat(45);
    const pairs = [
      [
        names("a", "documents", "page-draft"),
        names("b", "documents", "page_draft"),
      ],
      [names("a", "documents", "page"), names("b", "documents", "page")],
      [
        names("a", "documents", `${long}-one`),
        names("a", "documents", `${long}-two`),
      ],
      [names("a", "a__b", "c"), names("a", "a", "b__c")],
    ];
    for (const [left, right] of pairs) {
      expect(left).not.toBe(right);
      expect(`${left}_iud`.length).toBeLessThanOrEqual(63);
    }

    await run(`CREATE TABLE drafts (id TEXT PRIMARY KEY, title TEXT NOT NULL)`);
    for (const resourceType of ["page-draft", "page_draft"]) {
      await feed.installResourceChangeCapture(
        exec(),
        { app: "drafts", resourceType, table: "drafts", idColumn: "id" },
        "search",
      );
    }
    await run(`INSERT INTO drafts (id, title) VALUES ('d1', 'Draft')`);
    const { rows } = await run(
      `SELECT resource_type FROM app_resource_changes WHERE app = 'drafts' ORDER BY 1`,
    );
    expect(rows.map((row: any) => row.resource_type)).toEqual([
      "page-draft",
      "page_draft",
    ]);
  });

  it("works on tables with columns that have no equality operator", async () => {
    await run(
      `CREATE TABLE shapes (id TEXT PRIMARY KEY, title TEXT NOT NULL, meta JSON, origin POINT)`,
    );
    await feed.installResourceChangeCapture(
      exec(),
      { app: "shapes", resourceType: "shape", table: "shapes", idColumn: "id" },
      "search",
    );
    await run(
      `INSERT INTO shapes (id, title, meta, origin) VALUES ('s1', 'Shape', '{"a":1}', point(1, 2))`,
    );
    const seq = async () => {
      const { rows } = await run(
        `SELECT seq::text AS seq FROM app_resource_changes WHERE app = 'shapes'`,
      );
      return String(rows[0]!.seq);
    };
    const inserted = await seq();
    await run(`UPDATE shapes SET meta = '{"a":2}' WHERE id = 's1'`);
    const updated = await seq();
    expect(BigInt(updated)).toBeGreaterThan(BigInt(inserted));
    // An update that changes nothing still records nothing.
    await run(`UPDATE shapes SET title = title WHERE id = 's1'`);
    expect(await seq()).toBe(updated);
  });
});
