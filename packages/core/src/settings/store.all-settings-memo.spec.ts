import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      if (/^\s*select/i.test(input)) {
        return { rows: sqlite.prepare(input).all(), rowsAffected: 0 };
      }
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

const { getAllSettings, getSetting, putSetting, deleteSetting } =
  await import("./store.js");
const { runWithRequestContext } = await import("../server/request-context.js");

function fullTableReads(): number {
  return rawClient.execute.mock.calls.filter(([input]) => {
    const sql = typeof input === "string" ? input : input?.sql;
    return typeof sql === "string" && /SELECT key, value FROM/i.test(sql);
  }).length;
}

function singleKeyReads(): number {
  return rawClient.execute.mock.calls.filter(([input]) => {
    const sql = typeof input === "string" ? input : input?.sql;
    return (
      typeof sql === "string" && /SELECT value FROM .* WHERE key/i.test(sql)
    );
  }).length;
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  rawClient.execute.mockClear();
});

afterEach(() => {
  sqlite.close();
});

describe("getAllSettings request memo", () => {
  it("reads the whole table once per request, not once per call", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await putSetting("one", { v: 1 });
      rawClient.execute.mockClear();

      const first = await getAllSettings();
      const second = await getAllSettings();

      expect(first).toEqual({ one: { v: 1 } });
      expect(second).toEqual(first);
      expect(fullTableReads()).toBe(1);
    });
  });

  it("seeds the single-key cache so a later getSetting costs no query", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await putSetting("one", { v: 1 });
      rawClient.execute.mockClear();

      await getAllSettings();
      const value = await getSetting("one");

      expect(value).toEqual({ v: 1 });
      expect(singleKeyReads()).toBe(0);
    });
  });

  it("does not let the snapshot mask a write made in the same request", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await putSetting("one", { v: 1 });
      expect(await getAllSettings()).toEqual({ one: { v: 1 } });

      await putSetting("two", { v: 2 });
      expect(await getAllSettings()).toEqual({
        one: { v: 1 },
        two: { v: 2 },
      });

      await deleteSetting("one");
      expect(await getAllSettings()).toEqual({ two: { v: 2 } });
    });
  });

  it("does not leak a snapshot between two requests", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await putSetting("one", { v: 1 });
      expect(await getAllSettings()).toEqual({ one: { v: 1 } });
    });

    // A write from "elsewhere" — no request context, so no cache to update.
    await putSetting("two", { v: 2 });

    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      expect(await getAllSettings()).toEqual({
        one: { v: 1 },
        two: { v: 2 },
      });
    });
  });

  it("keeps a value written earlier in the request over the snapshot", async () => {
    // The seed must not clobber a written-through key with the DB's older row.
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await putSetting("one", { v: 1 });
      // Change the row out from under the request, simulating another writer.
      sqlite
        .prepare(`UPDATE settings SET value = ? WHERE key = ?`)
        .run(JSON.stringify({ v: 99 }), "one");

      await getAllSettings();
      expect(await getSetting("one")).toEqual({ v: 1 });
    });
  });

  it("still works with no request context at all (CLI / script paths)", async () => {
    await putSetting("one", { v: 1 });
    expect(await getAllSettings()).toEqual({ one: { v: 1 } });
    // Uncached without a context: two calls, two reads.
    rawClient.execute.mockClear();
    await getAllSettings();
    await getAllSettings();
    expect(fullTableReads()).toBe(2);
  });
});
