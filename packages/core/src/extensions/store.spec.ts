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
      intType: () => "INTEGER",
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
      statements.some((sql) =>
        /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+tool_history/i.test(sql),
      ),
    ).toBe(true);
    expect(
      statements.some((sql) => /RENAME\s+TO\s+tool_data_old/i.test(sql)),
    ).toBe(false);
    expect(
      statements.some((sql) => /DROP\s+TABLE\s+tool_data_old/i.test(sql)),
    ).toBe(false);
  }, 15_000);

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
      intType: () => "INTEGER",
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
      intType: () => "INTEGER",
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
      intType: () => "INTEGER",
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
    expect(
      client.execute.mock.calls.some((call) => {
        const input = call[0] as string | { sql: string };
        const sql = typeof input === "string" ? input : input.sql;
        return /INSERT\s+INTO\s+tool_history/i.test(sql);
      }),
    ).toBe(true);
  });

  it("surfaces extension marker persistence failures", async () => {
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
    const appStatePut = vi.fn(async () => {
      throw new Error("marker unavailable");
    });

    vi.doMock("../application-state/store.js", () => ({
      appStatePut,
    }));
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => client,
      getDialect: () => "sqlite",
      intType: () => "INTEGER",
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

    await expect(
      runWithRequestContext({ userEmail: "owner@example.com" }, () =>
        createExtension({
          name: "Foobar",
          content: "<div>Foobar</div>",
        }),
      ),
    ).rejects.toThrow("marker unavailable");

    expect(insertedRows).toHaveLength(1);
    expect(appStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "__extensions_change__",
      expect.objectContaining({ owner: "owner@example.com" }),
    );
  });

  it("excludes globally-hidden extensions by default and includes them on request", async () => {
    const allRows = [
      { id: "ext-visible", name: "Visible", hiddenAt: null },
      {
        id: "ext-hidden",
        name: "Hidden",
        hiddenAt: "2026-06-08T00:00:00.000Z",
      },
    ];
    // The helper combines accessFilter() with isNull(hiddenAt) via and() for
    // the default case, and skips it when includeGloballyHidden is true. We
    // spy on and()/isNull() (keeping the real drizzle module intact so
    // schema.ts's sql`` template still works) to detect which branch ran and
    // emulate the DB-side filter deterministically.
    const andSpy = vi.fn(() => ({ __hidesVisible: true }));
    const isNullSpy = vi.fn(() => ({}));
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((where: unknown) =>
            Promise.resolve(
              where && (where as any).__hidesVisible
                ? allRows.filter((row) => row.hiddenAt == null)
                : allRows,
            ),
          ),
        })),
      })),
    };
    const client = {
      execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
    };

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => client,
      getDialect: () => "sqlite",
      intType: () => "INTEGER",
      isPostgres: () => false,
      retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
    }));
    vi.doMock("../db/create-get-db.js", () => ({
      createGetDb: () => () => db,
    }));
    vi.doMock("../sharing/registry.js", () => ({
      registerShareableResource: vi.fn(),
    }));
    vi.doMock("../sharing/access.js", () => ({
      accessFilter: vi.fn(() => null),
      assertAccess: vi.fn(async () => ({ role: "owner", resource: {} })),
      resolveAccess: vi.fn(async () => ({ role: "owner", resource: {} })),
      ForbiddenError: class ForbiddenError extends Error {},
    }));
    vi.doMock("drizzle-orm", async (importOriginal) => {
      const actual = await importOriginal<typeof import("drizzle-orm")>();
      return { ...actual, and: andSpy, isNull: isNullSpy };
    });

    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { listExtensions } = await import("./store.js");

    const visibleOnly = await runWithRequestContext(
      { userEmail: "owner@example.com" },
      () => listExtensions({ includeHidden: true }),
    );
    expect(visibleOnly.map((row) => row.id)).toEqual(["ext-visible"]);
    expect(isNullSpy).toHaveBeenCalled();

    const withHidden = await runWithRequestContext(
      { userEmail: "owner@example.com" },
      () =>
        listExtensions({ includeHidden: true, includeGloballyHidden: true }),
    );
    expect(withHidden.map((row) => row.id)).toEqual([
      "ext-visible",
      "ext-hidden",
    ]);
  });

  it("globally hides and unhides an extension on the tools row", async () => {
    const statements: { sql: string; args: unknown[] }[] = [];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            { id: "ext-1", ownerEmail: "owner@example.com", visibility: "org" },
          ]),
        })),
      })),
    };
    const client = {
      execute: vi.fn(
        async (input: string | { sql: string; args: unknown[] }) => {
          if (typeof input !== "string") statements.push(input);
          return { rows: [], rowsAffected: 0 };
        },
      ),
    };

    vi.doMock("../application-state/store.js", () => ({
      appStatePut: vi.fn(async () => {}),
    }));
    vi.doMock("../server/poll.js", () => ({
      recordChange: vi.fn(),
    }));
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => client,
      getDialect: () => "sqlite",
      intType: () => "INTEGER",
      isPostgres: () => false,
      retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
    }));
    vi.doMock("../db/create-get-db.js", () => ({
      createGetDb: () => () => db,
    }));
    vi.doMock("../sharing/registry.js", () => ({
      registerShareableResource: vi.fn(),
    }));
    const assertAccess = vi.fn(async () => ({ role: "owner", resource: {} }));
    vi.doMock("../sharing/access.js", () => ({
      accessFilter: vi.fn(() => null),
      assertAccess,
      resolveAccess: vi.fn(async () => ({ role: "owner", resource: {} })),
      ForbiddenError: class ForbiddenError extends Error {},
    }));

    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { globalHideExtension, globalUnhideExtension } =
      await import("./store.js");

    await runWithRequestContext({ userEmail: "admin@example.com" }, () =>
      globalHideExtension("ext-1"),
    );
    expect(assertAccess).toHaveBeenCalledWith("extension", "ext-1", "admin");
    const hideStmt = statements.find((s) =>
      /UPDATE\s+tools\s+SET\s+hidden_at\s*=\s*\?/i.test(s.sql),
    );
    expect(hideStmt).toBeTruthy();
    expect(hideStmt?.args).toContain("admin@example.com");

    statements.length = 0;
    await runWithRequestContext({ userEmail: "admin@example.com" }, () =>
      globalUnhideExtension("ext-1"),
    );
    expect(
      statements.some((s) =>
        /UPDATE\s+tools\s+SET\s+hidden_at\s*=\s*NULL/i.test(s.sql),
      ),
    ).toBe(true);
  });

  it("refuses to flip an existing extension to public visibility", async () => {
    // Defense in depth — the framework `set-resource-visibility` action
    // already rejects 'public' for extensions, but `updateExtension` is also
    // called directly from the HTTP `PUT /extensions/:id` handler, so the
    // store helper must enforce the rule independently.
    const client = {
      execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
    };
    const db = {};

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => client,
      getDialect: () => "sqlite",
      intType: () => "INTEGER",
      isPostgres: () => false,
      retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
    }));
    vi.doMock("../db/create-get-db.js", () => ({
      createGetDb: () => () => db,
    }));
    vi.doMock("../sharing/registry.js", () => ({
      registerShareableResource: vi.fn(),
    }));
    vi.doMock("../sharing/access.js", () => ({
      accessFilter: vi.fn(() => null),
      assertAccess: vi.fn(async () => ({ role: "owner", resource: {} })),
      resolveAccess: vi.fn(async () => ({ role: "owner", resource: {} })),
      ForbiddenError: class ForbiddenError extends Error {
        statusCode = 403;
      },
    }));

    const { updateExtension } = await import("./store.js");
    await expect(
      updateExtension("ext-1", { visibility: "public" }),
    ).rejects.toThrow(/cannot be made public/i);
  });
});
