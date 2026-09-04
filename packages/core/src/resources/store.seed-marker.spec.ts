import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isPostgres: () => false,
  intType: () => "INTEGER",
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

let sqlite: Database.Database;
let writes: string[] = [];

const sharedClient = {
  async execute(arg: string | { sql: string; args?: unknown[] }) {
    const sql = typeof arg === "string" ? arg : arg.sql;
    const args = typeof arg === "string" ? [] : (arg.args ?? []);
    if (!/^\s*(select|create|pragma)/i.test(sql)) writes.push(sql);
    if (/^\s*create/i.test(sql)) {
      sqlite.exec(sql);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(sql);
    if (/^\s*select/i.test(sql)) {
      return { rows: stmt.all(...(args as any[])), rowsAffected: 0 };
    }
    const result = stmt.run(...(args as any[]));
    return { rows: [], rowsAffected: Number(result.changes ?? 0) };
  },
};

function seedInserts(): string[] {
  return writes.filter((sql) =>
    /INSERT (OR IGNORE )?INTO resources/i.test(sql),
  );
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  writes = [];
  vi.resetModules();
});

afterEach(() => {
  sqlite.close();
});

describe("default resource seeding is once per database, not per process", () => {
  it("skips every seed write on a second cold start", async () => {
    // `_doEnsureTable` runs once per PROCESS, which on serverless is once per
    // cold start. Production showed 53,785 `INSERT INTO resources … DO NOTHING`
    // for rows that had existed since day one.
    const first = await import("./store.js");
    await first.resourceList("__shared__");
    const firstSeeds = seedInserts().length;
    expect(firstSeeds).toBeGreaterThan(0);

    // Simulate a fresh isolate against the SAME database: module state resets,
    // the durable marker does not.
    writes = [];
    vi.resetModules();
    const second = await import("./store.js");
    await second.resourceList("__shared__");

    expect(seedInserts()).toEqual([]);
  });

  it("still seeds a database that has never been seeded", async () => {
    const store = await import("./store.js");
    const rows = await store.resourceList("__shared__");
    const paths = rows.map((r) => r.path);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("LEARNINGS.md");
  });

  it("does not re-seed personal defaults for the same owner on a new process", async () => {
    const first = await import("./store.js");
    await first.ensurePersonalDefaults("user@example.com");
    const firstSeeds = seedInserts().length;
    expect(firstSeeds).toBeGreaterThan(0);

    writes = [];
    vi.resetModules();
    const second = await import("./store.js");
    await second.ensurePersonalDefaults("user@example.com");
    expect(seedInserts()).toEqual([]);
  });

  it("seeds a DIFFERENT owner even after the first is marked", async () => {
    const store = await import("./store.js");
    await store.ensurePersonalDefaults("first@example.com");
    writes = [];
    await store.ensurePersonalDefaults("second@example.com");
    expect(seedInserts().length).toBeGreaterThan(0);
  });

  it("keys the personal marker case-insensitively on the owner", async () => {
    const store = await import("./store.js");
    await store.ensurePersonalDefaults("Mixed@Example.com");
    writes = [];
    vi.resetModules();
    const second = await import("./store.js");
    await second.ensurePersonalDefaults("mixed@example.com");
    expect(seedInserts()).toEqual([]);
  });
});
