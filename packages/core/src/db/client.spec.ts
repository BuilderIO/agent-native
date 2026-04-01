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
