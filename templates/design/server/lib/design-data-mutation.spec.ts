/**
 * Local-database integration coverage for design-data CAS mutations.
 *
 * Uses a real in-memory PGlite database and real Drizzle predicates. Concurrent
 * calls exercise PostgreSQL transactions, CAS confirmation, and post-commit reads.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  pglite: null as null | {
    query(
      sql: string,
      args?: unknown[],
    ): Promise<{ rows: Array<Record<string, unknown>> }>;
    close(): Promise<void>;
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
}));

vi.mock("../db/index.js", async () => {
  const [{ drizzle }, pgCore, { createRequire }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pg-core"),
    import("node:module"),
  ]);
  const { PGlite } = createRequire(
    new URL("../../../../packages/core/package.json", import.meta.url),
  )("@electric-sql/pglite");
  const designs = pgCore.pgTable("designs", {
    id: pgCore.text("id").primaryKey(),
    data: pgCore.text("data"),
    updatedAt: pgCore.text("updated_at"),
  });
  const pglite = await PGlite.create("memory://");
  await pglite.query(
    "CREATE TABLE designs (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT)",
  );
  localDb.pglite = pglite;
  return {
    getDb: () => drizzle(pglite, { schema: { designs } }),
    schema: { designs },
  };
});

import {
  InvalidDesignDataError,
  mutateDesignData,
} from "./design-data-mutation.js";

async function seed(
  data: string | null,
  updatedAt = "2026-07-09T00:00:00.000Z",
) {
  await localDb.pglite?.query(
    "INSERT INTO designs (id, data, updated_at) VALUES ($1, $2, $3)",
    ["design_1", data, updatedAt],
  );
}

async function persistedRow(): Promise<{
  data: string | null;
  updated_at: string;
}> {
  const result = await localDb.pglite?.query(
    "SELECT data, updated_at FROM designs WHERE id = $1",
    ["design_1"],
  );
  return result?.rows[0] as { data: string | null; updated_at: string };
}

beforeEach(async () => {
  await localDb.pglite?.query("DELETE FROM designs");
});

afterAll(async () => {
  await localDb.pglite?.close();
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
