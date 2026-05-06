import { afterEach, describe, expect, it, vi } from "vitest";

describe("extensions/store", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("initializes extension tables without rebuilding existing tool_data", async () => {
    const statements: string[] = [];
    const client = {
      execute: vi.fn(
        async (input: string | { sql: string; args: unknown[] }) => {
          statements.push(typeof input === "string" ? input : input.sql);
          return { rows: [], rowsAffected: 0 };
        },
      ),
    };

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => client,
      getDialect: () => "sqlite",
      isPostgres: () => false,
      retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
    }));
    vi.doMock("../db/create-get-db.js", () => ({
      createGetDb: () => () => ({}),
    }));
    vi.doMock("../sharing/registry.js", () => ({
      registerShareableResource: vi.fn(),
    }));

    const { ensureExtensionsTables } = await import("./store.js");

    await ensureExtensionsTables();

    expect(
      statements.some((sql) =>
        /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+tools/i.test(sql),
      ),
    ).toBe(true);
    expect(
      statements.some((sql) =>
        /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+extensions/i.test(sql),
      ),
    ).toBe(false);
    expect(
      statements.some((sql) => /RENAME\s+TO\s+tool_data_old/i.test(sql)),
    ).toBe(false);
    expect(
      statements.some((sql) => /DROP\s+TABLE\s+tool_data_old/i.test(sql)),
    ).toBe(false);
  });

  it("ignores the optional misnamed extensions-table backfill when the table is absent", async () => {
    const client = {
      execute: vi.fn(
        async (input: string | { sql: string; args: unknown[] }) => {
          const sql = typeof input === "string" ? input : input.sql;
          if (/\bFROM\s+extensions\b/i.test(sql)) {
            throw new Error("SQLITE_ERROR: no such table: extensions");
          }
          return { rows: [], rowsAffected: 0 };
        },
      ),
    };

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => client,
      getDialect: () => "sqlite",
      isPostgres: () => false,
      retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
    }));
    vi.doMock("../db/create-get-db.js", () => ({
      createGetDb: () => () => ({}),
    }));
    vi.doMock("../sharing/registry.js", () => ({
      registerShareableResource: vi.fn(),
    }));

    const { ensureExtensionsTables } = await import("./store.js");

    await expect(ensureExtensionsTables()).resolves.toBeUndefined();
  });
});
