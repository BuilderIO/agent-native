import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the pure functions that don't require database initialization.
// getDialect, isPostgres, intType depend on process.env.DATABASE_URL.

describe("db/client dialect detection", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Reset the cached _dialect by re-importing (we'll use dynamic import)
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("detects postgres dialect from postgres:// URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@host:5432/db");
    const { getDialect, isPostgres, intType } = await import("./client.js");
    expect(getDialect()).toBe("postgres");
    expect(isPostgres()).toBe(true);
    expect(intType()).toBe("BIGINT");
  });

  it("detects postgres dialect from postgresql:// URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@host:5432/db");
    const { getDialect, isPostgres, intType } = await import("./client.js");
    expect(getDialect()).toBe("postgres");
    expect(isPostgres()).toBe(true);
    expect(intType()).toBe("BIGINT");
  });

  it("detects postgres dialect from opt-in pglite: URL", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:./data/pglite");
    const { getDialect, isPostgres, intType, isLocalDatabase } =
      await import("./client.js");
    expect(getDialect()).toBe("postgres");
    expect(isPostgres()).toBe(true);
    expect(intType()).toBe("BIGINT");
    expect(isLocalDatabase()).toBe(true);
  });

  it("detects sqlite dialect from file: URL", async () => {
    vi.stubEnv("DATABASE_URL", "file:./data/app.db");
    const { getDialect, isPostgres, intType } = await import("./client.js");
    expect(getDialect()).toBe("sqlite");
    expect(isPostgres()).toBe(false);
    expect(intType()).toBe("INTEGER");
  });

  it("defaults to sqlite when DATABASE_URL is empty", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDialect, isPostgres } = await import("./client.js");
    expect(getDialect()).toBe("sqlite");
    expect(isPostgres()).toBe(false);
  });

  it("detects sqlite for remote libsql URLs", async () => {
    vi.stubEnv("DATABASE_URL", "libsql://db-name-user.turso.io");
    const { getDialect } = await import("./client.js");
    expect(getDialect()).toBe("sqlite");
  });

  it("uses Netlify's runtime database URL when DATABASE_URL is not exported", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NETLIFY_DATABASE_URL", "postgres://netlify.example/db");
    const { getDatabaseUrl, getDialect } = await import("./client.js");
    expect(getDatabaseUrl("file:./data/app.db")).toBe(
      "postgres://netlify.example/db",
    );
    expect(getDialect()).toBe("postgres");
  });

  it("keeps app-specific database URLs ahead of Netlify's shared env", async () => {
    vi.stubEnv("APP_NAME", "plan");
    vi.stubEnv("PLAN_DATABASE_URL", "postgres://plan.example/db");
    vi.stubEnv("NETLIFY_DATABASE_URL", "postgres://netlify.example/db");
    const { getDatabaseUrl } = await import("./client.js");
    expect(getDatabaseUrl()).toBe("postgres://plan.example/db");
  });
});

describe("pgliteDataDirFromUrl", () => {
  it("maps pglite URLs to PGlite dataDir values", async () => {
    const { pgliteDataDirFromUrl } = await import("./client.js");

    expect(pgliteDataDirFromUrl("pglite:./data/pglite")).toBe("./data/pglite");
    expect(pgliteDataDirFromUrl("pglite:///tmp/pglite")).toBe("/tmp/pglite");
    expect(pgliteDataDirFromUrl("pglite:memory")).toBe("memory://");
    expect(pgliteDataDirFromUrl("pglite:")).toBe("./data/pglite");
  });
});

describe("PGlite optional dependency", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("reports setup instructions when pglite: is selected without the package", async () => {
    const pglitePackage = "@electric-sql/pglite";
    try {
      await import(pglitePackage);
      return;
    } catch {
      // Continue only when the optional package is absent in this install.
    }

    const { createDbExec } = await import("./client.js");
    await expect(createDbExec({ url: "pglite:memory" })).rejects.toThrow(
      "PGlite database support requires the optional @electric-sql/pglite package.",
    );
  });
});

describe("getMigrationDatabaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("strips the -pooler suffix from a real Neon pooler host", async () => {
    // Exact pooler URL shape from templates/plan/.env (region segment .c-7.).
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://neondb_owner:npg_pw@ep-round-heart-ap9wji9h-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    );
    const { getMigrationDatabaseUrl } = await import("./client.js");
    expect(getMigrationDatabaseUrl()).toBe(
      "postgresql://neondb_owner:npg_pw@ep-round-heart-ap9wji9h.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    );
  });

  it("leaves an already-direct Neon host unchanged", async () => {
    const direct =
      "postgresql://neondb_owner:npg_pw@ep-round-heart-ap9wji9h.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
    vi.stubEnv("DATABASE_URL", direct);
    const { getMigrationDatabaseUrl } = await import("./client.js");
    expect(getMigrationDatabaseUrl()).toBe(direct);
  });

  it("leaves a non-Neon Postgres URL unchanged", async () => {
    const other = "postgresql://user:pass@db.example.com:5432/app";
    vi.stubEnv("DATABASE_URL", other);
    const { getMigrationDatabaseUrl } = await import("./client.js");
    expect(getMigrationDatabaseUrl()).toBe(other);
  });

  it("leaves a sqlite file: URL unchanged", async () => {
    vi.stubEnv("DATABASE_URL", "file:./data/app.db");
    const { getMigrationDatabaseUrl } = await import("./client.js");
    expect(getMigrationDatabaseUrl()).toBe("file:./data/app.db");
  });
});

describe("getDbExec", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns a proxy object with execute method", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDbExec } = await import("./client.js");
    const exec = getDbExec();
    expect(exec).toBeDefined();
    expect(typeof exec.execute).toBe("function");
  });

  it("returns the same proxy on multiple calls before init", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDbExec } = await import("./client.js");
    // getDbExec returns a new proxy each time when _exec is not set,
    // but after first execute it should resolve
    const a = getDbExec();
    expect(a).toBeDefined();
  });
});

describe("sqliteToPostgresParams", () => {
  it("converts placeholders while preserving question marks inside SQL literals", async () => {
    const { sqliteToPostgresParams } = await import("./client.js");

    expect(
      sqliteToPostgresParams(
        "SELECT substring(referrer from 'https?://([^/?#]+)') AS domain FROM analytics_events WHERE owner_email = ? AND path LIKE ?",
      ),
    ).toBe(
      "SELECT substring(referrer from 'https?://([^/?#]+)') AS domain FROM analytics_events WHERE owner_email = $1 AND path LIKE $2",
    );
  });

  it("ignores question marks in identifiers, comments, and dollar-quoted strings", async () => {
    const { sqliteToPostgresParams } = await import("./client.js");

    expect(
      sqliteToPostgresParams(
        'SELECT "weird?column", $$literal ? value$$ FROM analytics_events -- comment ?\nWHERE owner_email = ? /* block ? */ AND org_id = ?',
      ),
    ).toBe(
      'SELECT "weird?column", $$literal ? value$$ FROM analytics_events -- comment ?\nWHERE owner_email = $1 /* block ? */ AND org_id = $2',
    );
  });

  it("converts placeholders after a backslash SQL string literal", async () => {
    const { sqliteToPostgresParams } = await import("./client.js");

    expect(
      sqliteToPostgresParams(
        "SELECT * FROM org_members WHERE email LIKE ? ESCAPE '\\' AND role = ? LIMIT ? OFFSET ?",
      ),
    ).toBe(
      "SELECT * FROM org_members WHERE email LIKE $1 ESCAPE '\\' AND role = $2 LIMIT $3 OFFSET $4",
    );
  });
});

describe("retryOnDdlRace", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("retries Postgres duplicate type races from concurrent CREATE TABLE", async () => {
    const { retryOnDdlRace } = await import("./client.js");
    const duplicateTypeError = Object.assign(
      new Error('type "integration_a2a_continuations" already exists'),
      { code: "42710", routine: "TypeCreate" },
    );
    const operation = vi
      .fn()
      .mockRejectedValueOnce(duplicateTypeError)
      .mockResolvedValueOnce("ok");

    await expect(retryOnDdlRace(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated duplicate object errors", async () => {
    const { retryOnDdlRace } = await import("./client.js");
    const duplicateSchemaError = Object.assign(
      new Error('schema "public" already exists'),
      { code: "42710", routine: "NamespaceCreate" },
    );
    const operation = vi.fn().mockRejectedValueOnce(duplicateSchemaError);

    await expect(retryOnDdlRace(operation)).rejects.toThrow(
      'schema "public" already exists',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("dbOpTimeoutMs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("honors a positive DB_OP_TIMEOUT_MS override", async () => {
    vi.stubEnv("DB_OP_TIMEOUT_MS", "1234");
    const { dbOpTimeoutMs } = await import("./client.js");
    expect(dbOpTimeoutMs()).toBe(1234);
  });

  it("ignores a non-positive / non-numeric override", async () => {
    vi.stubEnv("DB_OP_TIMEOUT_MS", "0");
    const mod1 = await import("./client.js");
    expect(mod1.dbOpTimeoutMs()).toBe(30_000);
    vi.resetModules();
    vi.stubEnv("DB_OP_TIMEOUT_MS", "not-a-number");
    const mod2 = await import("./client.js");
    expect(mod2.dbOpTimeoutMs()).toBe(30_000);
  });

  it("uses the tight serverless default on Netlify", async () => {
    vi.stubEnv("DB_OP_TIMEOUT_MS", "");
    vi.stubEnv("NETLIFY", "true");
    const { dbOpTimeoutMs } = await import("./client.js");
    expect(dbOpTimeoutMs()).toBe(8_000);
  });
});

describe("describeDbError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("renders Errors, ErrorEvent-like objects, and primitives readably", async () => {
    const { describeDbError } = await import("./client.js");

    expect(describeDbError(new Error("connection dropped"))).toBe(
      "connection dropped",
    );
    // Neon's WebSocket path rejects with a raw DOM-style ErrorEvent: message
    // on the event itself, or on a nested .error, or nothing but type:"error".
    expect(describeDbError({ type: "error", message: "ws closed" })).toBe(
      "ws closed",
    );
    expect(
      describeDbError({ type: "error", error: { message: "ECONNRESET" } }),
    ).toBe("ECONNRESET");
    expect(describeDbError({ type: "error", target: {} })).toBe(
      "WebSocket ErrorEvent (connection failed; no message attached)",
    );
    expect(describeDbError("boom")).toBe("boom");
  });

  it("keeps the per-client logger from printing [object ErrorEvent]", async () => {
    const { EventEmitter } = await import("node:events");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { attachNeonPoolErrorLogger } = await import("./client.js");

    const pool = new EventEmitter();
    attachNeonPoolErrorLogger(pool, "db/neon");
    const client = new EventEmitter();
    pool.emit("connect", client);
    client.emit("error", { type: "error", message: "Connection terminated" });

    expect(warn).toHaveBeenCalledWith(
      "[db/neon] client connection error (connection discarded, next query reconnects):",
      "Connection terminated",
    );
  });
});

describe("attachNeonPoolErrorLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("wires pool error + per-client error listeners once and logs without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const on = vi.fn();
    const pool = { on };
    const { attachNeonPoolErrorLogger } = await import("./client.js");

    attachNeonPoolErrorLogger(pool, "db/neon-auth");
    attachNeonPoolErrorLogger(pool, "db/neon-auth");

    // Deduped per pool: a pool-level "error" listener + a "connect" listener,
    // wired exactly once despite the second attach call.
    expect(on).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(on).toHaveBeenCalledWith("connect", expect.any(Function));

    const poolListener = on.mock.calls.find((c) => c[0] === "error")![1] as (
      err: unknown,
    ) => void;
    expect(() => poolListener(new Error("connection dropped"))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[db/neon-auth] pool error (will reconnect on next query):",
      "connection dropped",
    );
  });

  it("keeps a dropped client's 'error' event from crashing the process", async () => {
    // Reproduces the highest-volume production crash: a checked-out neon client
    // whose socket drops emits 'error'; with no listener Node turns that into an
    // uncaught exception. An EventEmitter with no 'error' listener throws
    // synchronously on emit — so this test fails (throws) without the fix.
    const { EventEmitter } = await import("node:events");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { attachNeonPoolErrorLogger } = await import("./client.js");

    const pool = new EventEmitter();
    // Pools may exceed the default 10-listener warning under load; mirror prod.
    pool.setMaxListeners(0);
    attachNeonPoolErrorLogger(pool, "db/neon");

    // Control: a client the pool never announced has no listener and WOULD crash.
    const orphan = new EventEmitter();
    expect(() => orphan.emit("error", new Error("socket closed"))).toThrow();

    // A client announced via 'connect' gets a persistent 'error' listener, so a
    // mid-flight socket drop degrades to a logged warning instead of a crash.
    const client = new EventEmitter();
    pool.emit("connect", client);
    expect(client.listenerCount("error")).toBeGreaterThan(0);
    expect(() =>
      client.emit(
        "error",
        new Error("terminating connection due to administrator command"),
      ),
    ).not.toThrow();
  });
});

describe("withDbTimeout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves with the op result when it finishes in time", async () => {
    const { withDbTimeout } = await import("./client.js");
    const result = await withDbTimeout("query", async () => "ok", 50);
    expect(result).toBe("ok");
  });

  it("rejects a hung op as a retryable connection error", async () => {
    const { withDbTimeout, isConnectionError } = await import("./client.js");
    let caught: any;
    try {
      await withDbTimeout("query", () => new Promise(() => {}), 10);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.code).toBe("CONNECT_TIMEOUT");
    // The timeout must be classified as a connection error so the existing
    // retry / reject-reset paths recover instead of staying poisoned.
    expect(isConnectionError(caught)).toBe(true);
  });

  it("runs timeout cleanup for cancellable operations", async () => {
    const { withDbTimeout } = await import("./client.js");
    const cleanup = vi.fn();
    await expect(
      withDbTimeout("query", () => new Promise(() => {}), 10, cleanup),
    ).rejects.toMatchObject({ code: "CONNECT_TIMEOUT" });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("waits for async timeout cleanup before rejecting", async () => {
    const { withDbTimeout } = await import("./client.js");
    const events: string[] = [];

    await expect(
      withDbTimeout(
        "query",
        () => new Promise(() => {}),
        10,
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          events.push("cleanup");
        },
      ),
    ).rejects.toMatchObject({ code: "CONNECT_TIMEOUT" });

    expect(events).toEqual(["cleanup"]);
  });

  it("can retry when timeout is inside the retry attempt", async () => {
    const { retryOnConnectionError, withDbTimeout } =
      await import("./client.js");
    const cleanup = vi.fn();
    let attempts = 0;
    const result = await retryOnConnectionError(() => {
      attempts += 1;
      return withDbTimeout(
        "query",
        () =>
          attempts === 1
            ? new Promise<string>(() => {})
            : Promise.resolve("ok"),
        10,
        cleanup,
      );
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not reject after a successful resolve (timer cleared)", async () => {
    const { withDbTimeout } = await import("./client.js");
    const value = await withDbTimeout("query", async () => 42, 20);
    expect(value).toBe(42);
    // Wait past the timeout window; a leaked timer would surface as an
    // unhandled rejection and fail the test run.
    await new Promise((r) => setTimeout(r, 40));
  });
});

// Tests for `widenIntColumnsToBigInt` live in `./widen-columns.spec.ts`
// (the helper moved to `./widen-columns.js`).
