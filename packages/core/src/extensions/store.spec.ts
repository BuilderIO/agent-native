import { afterEach, describe, expect, it, vi } from "vitest";

describe("tools/store", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("initializes tool tables without rebuilding existing tool_data", async () => {
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

    const { ensureToolsTables } = await import("./store.js");

    await ensureToolsTables();

    expect(
      statements.some((sql) => /RENAME\s+TO\s+tool_data_old/i.test(sql)),
    ).toBe(false);
    expect(
      statements.some((sql) => /DROP\s+TABLE\s+tool_data_old/i.test(sql)),
    ).toBe(false);
  });
});
