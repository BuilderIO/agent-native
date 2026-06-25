import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These helpers resolve `isPostgres()` through `./client.js`, which derives the
// dialect from `process.env.DATABASE_URL`. The tests stub that env and pass an
// injected fake client, so no real database is required.

describe("ddl-guard", () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = originalEnv;
    vi.resetModules();
  });

  function recordingClient(
    handler: (sql: string) => { rows: unknown[] } | undefined = () => undefined,
  ) {
    const calls: string[] = [];
    const client = {
      execute: async (sql: string | { sql: string; args?: unknown[] }) => {
        const text = typeof sql === "string" ? sql : sql.sql;
        calls.push(text);
        return handler(text) ?? { rows: [], rowsAffected: 0 };
      },
      transaction: async (fn: (tx: any) => Promise<unknown>) => {
        calls.push("BEGIN");
        try {
          const result = await fn(client);
          calls.push("COMMIT");
          return result;
        } catch (err) {
          calls.push("ROLLBACK");
          throw err;
        }
      },
    } as any;
    return { client, calls };
  }

  describe("pgTableExists / pgColumnExists / pgIndexExists", () => {
    it("are no-ops on SQLite (never query)", async () => {
      vi.stubEnv("DATABASE_URL", "file:./data/app.db");
      const { pgTableExists, pgColumnExists, pgIndexExists } =
        await import("./ddl-guard.js");
      const { client, calls } = recordingClient();
      expect(await pgTableExists("settings", client)).toBe(false);
      expect(await pgColumnExists("settings", "x", client)).toBe(false);
      expect(await pgIndexExists("settings_idx", client)).toBe(false);
      expect(calls).toEqual([]);
    });

    it("report existence on Postgres from information_schema / pg_indexes", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { pgTableExists, pgColumnExists, pgIndexExists } =
        await import("./ddl-guard.js");
      const present = recordingClient(() => ({ rows: [{ ok: 1 }] }));
      expect(await pgTableExists("app_secrets", present.client)).toBe(true);
      expect(
        await pgColumnExists("app_secrets", "description", present.client),
      ).toBe(true);
      expect(
        await pgIndexExists("settings_updated_at_idx", present.client),
      ).toBe(true);

      const absent = recordingClient(() => ({ rows: [] }));
      expect(await pgTableExists("app_secrets", absent.client)).toBe(false);
      expect(
        await pgColumnExists("app_secrets", "description", absent.client),
      ).toBe(false);
    });

    it("reject non-identifier names without querying", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { pgTableExists, pgColumnExists } = await import("./ddl-guard.js");
      const { client, calls } = recordingClient(() => ({ rows: [{ ok: 1 }] }));
      expect(await pgTableExists("app_secrets; DROP TABLE x", client)).toBe(
        false,
      );
      expect(await pgColumnExists("app_secrets", "bad name", client)).toBe(
        false,
      );
      expect(calls).toEqual([]);
    });

    it("treat an unreadable information_schema as 'unknown' (false)", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { pgTableExists } = await import("./ddl-guard.js");
      const throwing = {
        execute: async () => {
          throw new Error("permission denied for relation");
        },
      } as any;
      expect(await pgTableExists("app_secrets", throwing)).toBe(false);
    });
  });

  describe("runGuardedDdl", () => {
    it("runs DDL directly on SQLite (no transaction / lock_timeout)", async () => {
      vi.stubEnv("DATABASE_URL", "file:./data/app.db");
      const { runGuardedDdl } = await import("./ddl-guard.js");
      const { client, calls } = recordingClient();
      const ran = await runGuardedDdl("CREATE TABLE foo (id TEXT)", {
        injectedClient: client,
      });
      expect(ran).toBe(true);
      expect(calls).toEqual(["CREATE TABLE foo (id TEXT)"]);
    });

    it("wraps Postgres DDL in a transaction with SET LOCAL lock_timeout", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { runGuardedDdl } = await import("./ddl-guard.js");
      const { client, calls } = recordingClient();
      const ran = await runGuardedDdl("CREATE TABLE foo (id TEXT)", {
        injectedClient: client,
        lockTimeout: "3s",
      });
      expect(ran).toBe(true);
      expect(calls).toEqual([
        "BEGIN",
        "SET LOCAL lock_timeout = '3s'",
        "CREATE TABLE foo (id TEXT)",
        "COMMIT",
      ]);
      // The lock_timeout is transaction-scoped (SET LOCAL) — no session-level
      // SET or RESET leaks onto the pooled connection.
      expect(calls.some((c) => /^SET lock_timeout/.test(c))).toBe(false);
      expect(calls.some((c) => /RESET lock_timeout/.test(c))).toBe(false);
    });

    it("swallows a lock-timeout error and returns false (still resolves)", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { runGuardedDdl } = await import("./ddl-guard.js");
      const lockErr = Object.assign(
        new Error("canceling statement due to lock timeout"),
        {
          code: "55P03",
        },
      );
      const client = {
        execute: async () => ({ rows: [], rowsAffected: 0 }),
        transaction: async (fn: (tx: any) => Promise<unknown>) => {
          // Simulate the DDL inside the tx hitting a lock timeout.
          return fn({
            execute: async (sql: string | { sql: string }) => {
              const text = typeof sql === "string" ? sql : sql.sql;
              if (/CREATE TABLE/i.test(text)) throw lockErr;
              return { rows: [], rowsAffected: 0 };
            },
          });
        },
      } as any;
      const ran = await runGuardedDdl("CREATE TABLE foo (id TEXT)", {
        injectedClient: client,
      });
      expect(ran).toBe(false);
    });

    it("rethrows non-lock-timeout errors", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { runGuardedDdl } = await import("./ddl-guard.js");
      const client = {
        execute: async () => ({ rows: [], rowsAffected: 0 }),
        transaction: async (fn: (tx: any) => Promise<unknown>) =>
          fn({
            execute: async (sql: string | { sql: string }) => {
              const text = typeof sql === "string" ? sql : sql.sql;
              if (/CREATE TABLE/i.test(text)) {
                throw new Error("syntax error at or near");
              }
              return { rows: [], rowsAffected: 0 };
            },
          }),
      } as any;
      await expect(
        runGuardedDdl("CREATE TABLE foo (id TEXT)", { injectedClient: client }),
      ).rejects.toThrow("syntax error");
    });

    it("falls back to session SET + RESET when no transaction is available", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { runGuardedDdl } = await import("./ddl-guard.js");
      const calls: string[] = [];
      const client = {
        execute: async (sql: string | { sql: string }) => {
          calls.push(typeof sql === "string" ? sql : sql.sql);
          return { rows: [], rowsAffected: 0 };
        },
        // no transaction
      } as any;
      const ran = await runGuardedDdl("CREATE TABLE foo (id TEXT)", {
        injectedClient: client,
      });
      expect(ran).toBe(true);
      expect(calls).toEqual([
        "SET lock_timeout = '3s'",
        "CREATE TABLE foo (id TEXT)",
        "RESET lock_timeout",
      ]);
    });
  });

  describe("isLockTimeoutError", () => {
    it("matches SQLSTATE 55P03 and lock-timeout messages", async () => {
      const { isLockTimeoutError } = await import("./ddl-guard.js");
      expect(isLockTimeoutError({ code: "55P03" })).toBe(true);
      expect(
        isLockTimeoutError(
          new Error("canceling statement due to lock timeout"),
        ),
      ).toBe(true);
      expect(isLockTimeoutError(new Error("syntax error"))).toBe(false);
      expect(isLockTimeoutError(null)).toBe(false);
    });
  });
});
