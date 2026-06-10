import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
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

const { getSetting, putSetting, deleteSetting } = await import("./store.js");

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("settings store", () => {
  it("issues the poll-path index DDL on init", async () => {
    // The first store call triggers ensureTable(), which must create the
    // settings_updated_at_idx index so MAX(updated_at) poll queries avoid
    // full table scans. Capture which SQL strings are executed and assert.
    const seen: string[] = [];
    const orig = rawClient.execute.getMockImplementation()!;
    rawClient.execute.mockImplementation(
      async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === "string" ? input : input.sql;
        seen.push(sql);
        return orig(input);
      },
    );
    try {
      await putSetting("probe", { x: 1 });
    } finally {
      rawClient.execute.mockImplementation(orig);
    }
    expect(seen).toContain(
      "CREATE INDEX IF NOT EXISTS settings_updated_at_idx ON settings (updated_at)",
    );
  });

  it("round-trips a value via put/get", async () => {
    await putSetting("theme", { value: "dark" });
    const result = await getSetting("theme");
    expect(result).toEqual({ value: "dark" });
  });

  it("returns null for a missing key", async () => {
    const result = await getSetting("does-not-exist");
    expect(result).toBeNull();
  });

  it("deletes an existing key and returns true", async () => {
    await putSetting("to-delete", { keep: false });
    const deleted = await deleteSetting("to-delete");
    expect(deleted).toBe(true);
    expect(await getSetting("to-delete")).toBeNull();
  });

  it("returns false when deleting a key that does not exist", async () => {
    const deleted = await deleteSetting("ghost");
    expect(deleted).toBe(false);
  });
});
