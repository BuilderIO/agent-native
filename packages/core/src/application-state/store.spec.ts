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
  transaction: vi.fn(async <T>(fn: (tx: typeof rawClient) => Promise<T>) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(rawClient);
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }),
};
const atomicBatch = vi.fn(
  async (statements: readonly (string | { sql: string; args?: unknown[] })[]) =>
    rawClient.transaction(async (tx) => {
      const results = [];
      for (const statement of statements) {
        results.push(await tx.execute(statement));
      }
      return results;
    }),
);

const emitAppStateChange = vi.fn();
const emitAppStateDelete = vi.fn();
const dbMockState = vi.hoisted(() => ({
  localDatabase: true,
  dialect: "sqlite" as "sqlite" | "postgres" | "d1",
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ ...rawClient, atomicBatch }),
  getDialect: () => dbMockState.dialect,
  intType: () => "INTEGER",
  isConnectionError: () => false,
  isLocalDatabase: () => dbMockState.localDatabase,
  isPostgres: () => false,
}));

vi.mock("./emitter.js", () => ({
  emitAppStateChange: (...args: unknown[]) => emitAppStateChange(...args),
  emitAppStateDelete: (...args: unknown[]) => emitAppStateDelete(...args),
}));

const {
  appStatePut,
  appStateGet,
  appStateGetMany,
  appStateCompareAndSet,
  appStateCompareAndSetMany,
  appStateList,
  appStateDeleteByPrefix,
} = await import("./store.js");

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
  dbMockState.localDatabase = true;
  dbMockState.dialect = "sqlite";
});

describe("application-state store", () => {
  it("issues hot-path index DDL on init", async () => {
    // ensureTable() is triggered by the first store call and issues CREATE
    // TABLE + CREATE INDEX. Capture which SQL strings rawClient.execute
    // receives and assert the two poll-path indexes are among them.
    // Restore the original implementation immediately after so later tests
    // in this file are not affected.
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
      await appStatePut(SESSION, "probe", { x: 1 });
    } finally {
      rawClient.execute.mockImplementation(orig);
    }
    expect(seen).toContain(
      "CREATE INDEX IF NOT EXISTS app_state_updated_at_idx ON application_state (updated_at)",
    );
    expect(seen).toContain(
      "CREATE INDEX IF NOT EXISTS app_state_key_updated_idx ON application_state (key, updated_at)",
    );
  });

  it("lists literal prefixes without treating underscores as LIKE wildcards", async () => {
    await appStatePut(SESSION, "compose_draft", { id: "draft" });
    await appStatePut(SESSION, "composeXdraft", { id: "not-draft" });

    const rows = await appStateList(SESSION, "compose_");

    expect(rows).toEqual([{ key: "compose_draft", value: { id: "draft" } }]);
  });

  it("reads several exact keys in one query and preserves missing keys", async () => {
    await appStatePut(SESSION, "apollo", { apiKey: "example-apollo-key" });
    await appStatePut(SESSION, "gong", { apiKey: "example-gong-key" });
    await appStatePut("other@example.com", "pylon", {
      apiKey: "example-other-key",
    });
    rawClient.execute.mockClear();

    const values = await appStateGetMany(SESSION, [
      "apollo",
      "gong",
      "pylon",
      "apollo",
    ]);

    expect(values).toEqual({
      apollo: { apiKey: "example-apollo-key" },
      gong: { apiKey: "example-gong-key" },
      pylon: null,
    });
    expect(rawClient.execute).toHaveBeenCalledTimes(1);
    expect(rawClient.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("key IN (?, ?, ?)"),
        args: [SESSION, "apollo", "gong", "pylon"],
      }),
    );
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

  it("atomically updates only when the stored value is unchanged", async () => {
    await appStatePut(SESSION, "rewrite", { repromptId: "r1" });
    emitAppStateChange.mockClear();

    await expect(
      appStateCompareAndSet(
        SESSION,
        "rewrite",
        { repromptId: "stale" },
        { repromptId: "r2" },
      ),
    ).resolves.toBe(false);
    expect(await appStateGet(SESSION, "rewrite")).toEqual({ repromptId: "r1" });
    expect(emitAppStateChange).not.toHaveBeenCalled();

    await expect(
      appStateCompareAndSet(
        SESSION,
        "rewrite",
        { repromptId: "r1" },
        { repromptId: "r2" },
      ),
    ).resolves.toBe(true);
    expect(await appStateGet(SESSION, "rewrite")).toEqual({ repromptId: "r2" });
    expect(emitAppStateChange).toHaveBeenCalledWith(
      "rewrite",
      undefined,
      SESSION,
    );
  });

  it("atomically deletes only the expected stored value", async () => {
    await appStatePut(SESSION, "rewrite", { proposalId: "p2" });
    emitAppStateDelete.mockClear();

    await expect(
      appStateCompareAndSet(SESSION, "rewrite", { proposalId: "p1" }, null),
    ).resolves.toBe(false);
    expect(await appStateGet(SESSION, "rewrite")).toEqual({ proposalId: "p2" });
    expect(emitAppStateDelete).not.toHaveBeenCalled();

    await expect(
      appStateCompareAndSet(SESSION, "rewrite", { proposalId: "p2" }, null),
    ).resolves.toBe(true);
    expect(await appStateGet(SESSION, "rewrite")).toBeNull();
    expect(emitAppStateDelete).toHaveBeenCalledWith(
      "rewrite",
      undefined,
      SESSION,
    );
  });

  it("atomically creates a value only while its key is absent", async () => {
    await expect(
      appStateCompareAndSet(SESSION, "rewrite", null, { repromptId: "r1" }),
    ).resolves.toBe(true);
    await expect(
      appStateCompareAndSet(SESSION, "rewrite", null, { repromptId: "r2" }),
    ).resolves.toBe(false);
    expect(await appStateGet(SESSION, "rewrite")).toEqual({ repromptId: "r1" });
  });

  it("rolls back every key when one operation in a multi-key CAS misses", async () => {
    await appStatePut(SESSION, "pending", { repromptId: "r1" });
    await appStatePut(SESSION, "proposal", { proposalId: "p1" });

    await expect(
      appStateCompareAndSetMany(SESSION, [
        {
          key: "pending",
          expectedValue: { repromptId: "r1" },
          nextValue: null,
        },
        {
          key: "proposal",
          expectedValue: { proposalId: "stale" },
          nextValue: null,
        },
      ]),
    ).resolves.toBe(false);
    expect(await appStateGet(SESSION, "pending")).toEqual({ repromptId: "r1" });
    expect(await appStateGet(SESSION, "proposal")).toEqual({
      proposalId: "p1",
    });

    await expect(
      appStateCompareAndSetMany(SESSION, [
        {
          key: "pending",
          expectedValue: { repromptId: "r1" },
          nextValue: null,
        },
        {
          key: "proposal",
          expectedValue: { proposalId: "p1" },
          nextValue: null,
        },
      ]),
    ).resolves.toBe(true);
    expect(await appStateGet(SESSION, "pending")).toBeNull();
    expect(await appStateGet(SESSION, "proposal")).toBeNull();
  });

  it("uses an atomic D1 batch and rolls back every mutation on a mismatch", async () => {
    dbMockState.dialect = "d1";
    await appStatePut(SESSION, "pending", { repromptId: "r1" });
    await appStatePut(SESSION, "proposal", { proposalId: "p1" });
    atomicBatch.mockClear();
    emitAppStateChange.mockClear();
    emitAppStateDelete.mockClear();

    await expect(
      appStateCompareAndSetMany(SESSION, [
        {
          key: "pending",
          expectedValue: { repromptId: "r1" },
          nextValue: null,
        },
        {
          key: "proposal",
          expectedValue: { proposalId: "stale" },
          nextValue: null,
        },
      ]),
    ).resolves.toBe(false);
    expect(atomicBatch).toHaveBeenCalledTimes(1);
    const statements = atomicBatch.mock.calls[0]![0];
    expect(statements.slice(1, 3)).toEqual([
      expect.objectContaining({ sql: expect.stringContaining("WHERE NOT") }),
      expect.objectContaining({ sql: expect.stringContaining("WHERE NOT") }),
    ]);
    expect(
      statements.some((statement) =>
        typeof statement === "string"
          ? /^(?:BEGIN|COMMIT|ROLLBACK)/i.test(statement)
          : /^(?:BEGIN|COMMIT|ROLLBACK)/i.test(statement.sql),
      ),
    ).toBe(false);
    expect(await appStateGet(SESSION, "pending")).toEqual({ repromptId: "r1" });
    expect(await appStateGet(SESSION, "proposal")).toEqual({
      proposalId: "p1",
    });
    expect(emitAppStateChange).not.toHaveBeenCalled();
    expect(emitAppStateDelete).not.toHaveBeenCalled();

    await expect(
      appStateCompareAndSetMany(SESSION, [
        {
          key: "pending",
          expectedValue: { repromptId: "r1" },
          nextValue: null,
        },
        {
          key: "proposal",
          expectedValue: { proposalId: "p1" },
          nextValue: null,
        },
      ]),
    ).resolves.toBe(true);
    expect(await appStateGet(SESSION, "pending")).toBeNull();
    expect(await appStateGet(SESSION, "proposal")).toBeNull();
  });

  it("atomically applies mixed D1 update, insert, and delete operations", async () => {
    dbMockState.dialect = "d1";
    await appStatePut(SESSION, "pending", { repromptId: "r1" });
    await appStatePut(SESSION, "prior", { proposalId: "p1" });

    await expect(
      appStateCompareAndSetMany(SESSION, [
        {
          key: "pending",
          expectedValue: { repromptId: "r1" },
          nextValue: { repromptId: "r2" },
        },
        {
          key: "current",
          expectedValue: null,
          nextValue: { proposalId: "p2" },
        },
        {
          key: "prior",
          expectedValue: { proposalId: "p1" },
          nextValue: null,
        },
      ]),
    ).resolves.toBe(true);
    expect(await appStateGet(SESSION, "pending")).toEqual({ repromptId: "r2" });
    expect(await appStateGet(SESSION, "current")).toEqual({ proposalId: "p2" });
    expect(await appStateGet(SESSION, "prior")).toBeNull();
  });

  it("propagates non-guard D1 batch failures", async () => {
    dbMockState.dialect = "d1";
    await appStatePut(SESSION, "pending", { repromptId: "r1" });
    atomicBatch.mockRejectedValueOnce(new Error("D1 batch unavailable"));

    await expect(
      appStateCompareAndSetMany(SESSION, [
        {
          key: "pending",
          expectedValue: { repromptId: "r1" },
          nextValue: null,
        },
      ]),
    ).rejects.toThrow("D1 batch unavailable");
    expect(await appStateGet(SESSION, "pending")).toEqual({ repromptId: "r1" });
  });

  it("rejects oversized hosted application_state values", async () => {
    dbMockState.localDatabase = false;

    await expect(
      appStatePut(SESSION, "huge", { data: "x".repeat(1024 * 1024 + 1) }),
    ).rejects.toThrow(/too large for hosted SQL storage/);
  });
});
