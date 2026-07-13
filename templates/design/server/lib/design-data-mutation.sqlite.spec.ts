/**
 * Local-database integration coverage for design-data CAS mutations.
 *
 * Unlike the action interleaving spec, this uses a real in-memory
 * better-sqlite3 database, real Drizzle predicates, and the framework's actual
 * async transaction patch. Concurrent calls therefore exercise BEGIN
 * IMMEDIATE, commit, CAS confirmation, and post-commit reads end to end.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  sqlite: null as null | {
    close(): void;
    exec(sql: string): void;
    inTransaction: boolean;
    prepare(sql: string): {
      run(...args: unknown[]): unknown;
      get(...args: unknown[]): unknown;
    };
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
}));

vi.mock("../db/index.js", async () => {
  const [{ createRequire }, { drizzle }, sqliteCore, coreDb] =
    await Promise.all([
      import("node:module"),
      import("drizzle-orm/better-sqlite3"),
      import("drizzle-orm/sqlite-core"),
      import("@agent-native/core/testing"),
    ]);

  const designs = sqliteCore.sqliteTable("designs", {
    id: sqliteCore.text("id").primaryKey(),
    data: sqliteCore.text("data"),
    updatedAt: sqliteCore.text("updated_at"),
  });
  const requireFromCore = createRequire(
    new URL("../../../../packages/core/package.json", import.meta.url),
  );
  const Database = requireFromCore("better-sqlite3") as new (
    filename: string,
  ) => NonNullable<typeof localDb.sqlite>;
  const sqlite = new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE designs (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT)",
  );
  const rawDb = drizzle(sqlite as never, {
    schema: { designs },
  }) as unknown as ReturnType<typeof drizzle> & { session: unknown };
  const db = coreDb.patchBetterSqliteTransactions(rawDb, sqlite);
  localDb.sqlite = sqlite;
  return { getDb: () => db, schema: { designs } };
});

import {
  InvalidDesignDataError,
  mutateDesignData,
} from "./design-data-mutation.js";

async function seed(
  data: string | null,
  updatedAt = "2026-07-09T00:00:00.000Z",
) {
  localDb.sqlite
    ?.prepare("INSERT INTO designs (id, data, updated_at) VALUES (?, ?, ?)")
    .run("design_1", data, updatedAt);
}

async function persistedRow(): Promise<{
  data: string | null;
  updated_at: string;
}> {
  return localDb.sqlite
    ?.prepare("SELECT data, updated_at FROM designs WHERE id = ?")
    .get("design_1") as { data: string | null; updated_at: string };
}

beforeEach(async () => {
  localDb.sqlite?.exec("DELETE FROM designs");
});

afterAll(() => {
  localDb.sqlite?.close();
});

describe("mutateDesignData with real local SQL transactions", () => {
  it("serializes concurrent sibling mutations and confirms both persisted", async () => {
    await seed(JSON.stringify({ keep: true, values: {} }));

    await Promise.all([
      mutateDesignData({
        designId: "design_1",
        mutate: (current) => ({
          ...current,
          values: {
            ...(current.values as Record<string, unknown>),
            first: 1,
          },
        }),
        isApplied: (data) =>
          (data.values as Record<string, unknown>)?.first === 1,
      }),
      mutateDesignData({
        designId: "design_1",
        mutate: (current) => ({
          ...current,
          values: {
            ...(current.values as Record<string, unknown>),
            second: 2,
          },
        }),
        isApplied: (data) =>
          (data.values as Record<string, unknown>)?.second === 2,
      }),
    ]);

    const row = await persistedRow();
    expect(JSON.parse(row.data ?? "null")).toEqual({
      keep: true,
      values: { first: 1, second: 2 },
    });
  });

  it("treats a legacy SQL NULL data value as an empty record and CASes with IS NULL", async () => {
    const futureRevision = "2099-01-01T00:00:00.000Z";
    await seed(null, futureRevision);

    const result = await mutateDesignData({
      designId: "design_1",
      now: () => new Date("2026-07-09T00:00:00.000Z"),
      mutate: (current) => ({ ...current, recovered: true }),
      isApplied: (data) => data.recovered === true,
    });

    const row = await persistedRow();
    expect(JSON.parse(row.data ?? "null")).toEqual({
      recovered: true,
    });
    expect(result.updatedAt).toBe("2099-01-01T00:00:00.001Z");
  });

  it("preserves explicit property deletion", async () => {
    await seed(JSON.stringify({ keep: true, removeMe: true }));

    await mutateDesignData({
      designId: "design_1",
      mutate: (current) => {
        const next = { ...current };
        delete next.removeMe;
        return next;
      },
      isApplied: (data) => !("removeMe" in data),
    });

    const row = await persistedRow();
    expect(JSON.parse(row.data ?? "null")).toEqual({ keep: true });
  });

  it("fails loud and leaves malformed non-null JSON untouched", async () => {
    await seed("{broken-json");

    await expect(
      mutateDesignData({
        designId: "design_1",
        mutate: (current) => ({ ...current, shouldNotPersist: true }),
        isApplied: (data) => data.shouldNotPersist === true,
      }),
    ).rejects.toBeInstanceOf(InvalidDesignDataError);
    expect((await persistedRow()).data).toBe("{broken-json");
  });
});
