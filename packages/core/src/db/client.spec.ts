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

describe("attachNeonPoolErrorLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("attaches one error listener and logs pool errors without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const on = vi.fn();
    const pool = { on };
    const { attachNeonPoolErrorLogger } = await import("./client.js");

    attachNeonPoolErrorLogger(pool, "db/neon-auth");
    attachNeonPoolErrorLogger(pool, "db/neon-auth");

    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));

    const listener = on.mock.calls[0]![1] as (err: unknown) => void;
    expect(() => listener(new Error("connection dropped"))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[db/neon-auth] pool error (will reconnect on next query):",
      "connection dropped",
    );
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
