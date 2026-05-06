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

  it("retries table initialization after a transient setup failure", async () => {
    let failCreateToolsOnce = true;
    const statements: string[] = [];
    const client = {
      execute: vi.fn(
        async (input: string | { sql: string; args: unknown[] }) => {
          const sql = typeof input === "string" ? input : input.sql;
          statements.push(sql);
          if (
            failCreateToolsOnce &&
            /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+tools/i.test(sql)
          ) {
            failCreateToolsOnce = false;
            throw new Error("SQLITE_BUSY: database is locked");
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

    await expect(ensureExtensionsTables()).rejects.toThrow("SQLITE_BUSY");
    await expect(ensureExtensionsTables()).resolves.toBeUndefined();
    expect(
      statements.filter((sql) =>
        /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+tools/i.test(sql),
      ),
    ).toHaveLength(2);
  });

  it("creates new extensions as private even inside an organization", async () => {
    const insertedRows: unknown[] = [];
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(async (row: unknown) => {
          insertedRows.push(row);
        }),
      })),
    };
    const client = {
      execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
    };

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => client,
      getDialect: () => "sqlite",
      isPostgres: () => false,
      retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
    }));
    vi.doMock("../db/create-get-db.js", () => ({
      createGetDb: () => () => db,
    }));
    vi.doMock("../sharing/registry.js", () => ({
      registerShareableResource: vi.fn(),
    }));

    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { createExtension } = await import("./store.js");

    const extension = await runWithRequestContext(
      { userEmail: "owner@example.com", orgId: "org-123" },
      () =>
        createExtension({
          name: "Foobar",
          content: "<div>Foobar</div>",
        }),
    );

    expect(extension).toMatchObject({
      name: "Foobar",
      ownerEmail: "owner@example.com",
      orgId: "org-123",
      visibility: "private",
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ visibility: "private" });
  });
});
