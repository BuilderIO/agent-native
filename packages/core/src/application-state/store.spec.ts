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

const emitAppStateChange = vi.fn();
const emitAppStateDelete = vi.fn();

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isConnectionError: () => false,
  isPostgres: () => false,
}));

vi.mock("./emitter.js", () => ({
  emitAppStateChange: (...args: unknown[]) => emitAppStateChange(...args),
  emitAppStateDelete: (...args: unknown[]) => emitAppStateDelete(...args),
}));

const { appStatePut, appStateGet, appStateList, appStateDeleteByPrefix } =
  await import("./store.js");

const SESSION = "alice@example.com";

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS application_state (
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, key)
  )`);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("application-state store", () => {
  it("lists literal prefixes without treating underscores as LIKE wildcards", async () => {
    await appStatePut(SESSION, "compose_draft", { id: "draft" });
    await appStatePut(SESSION, "composeXdraft", { id: "not-draft" });

    const rows = await appStateList(SESSION, "compose_");

    expect(rows).toEqual([{ key: "compose_draft", value: { id: "draft" } }]);
  });

  it("deletes literal prefixes without treating LIKE metacharacters as wildcards", async () => {
    await appStatePut(SESSION, "compose_%", { id: "draft" });
    await appStatePut(SESSION, "compose_X", { id: "not-draft" });
    await appStatePut(SESSION, "compose_foo", { id: "also-not-draft" });

    const deleted = await appStateDeleteByPrefix(SESSION, "compose_%");

    expect(deleted).toBe(1);
    expect(await appStateGet(SESSION, "compose_%")).toBeNull();
    expect(await appStateGet(SESSION, "compose_X")).toEqual({
      id: "not-draft",
    });
    expect(await appStateGet(SESSION, "compose_foo")).toEqual({
      id: "also-not-draft",
    });
    expect(emitAppStateDelete).toHaveBeenCalledWith(
      "compose_%",
      undefined,
      SESSION,
    );
  });
});
