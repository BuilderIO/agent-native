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

  /** A client that answers the two batched introspection queries realistically. */
  function introspectingClient(schema: {
    tables?: Record<string, string[]>;
    indexes?: string[];
  }) {
    const calls: string[] = [];
    const client = {
      execute: async (sql: string | { sql: string; args?: unknown[] }) => {
        const text = typeof sql === "string" ? sql : sql.sql;
        calls.push(text);
        if (/FROM information_schema\.columns/.test(text)) {
          const rows: unknown[] = [];
          for (const [table, columns] of Object.entries(schema.tables ?? {})) {
            for (const column of columns) {
              rows.push({ table_name: table, column_name: column });
            }
          }
          return { rows, rowsAffected: 0 };
        }
        if (/FROM pg_indexes/.test(text)) {
          return {
            rows: (schema.indexes ?? []).map((indexname) => ({ indexname })),
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
      transaction: async (fn: (tx: any) => Promise<unknown>) => {
        calls.push("BEGIN");
        const result = await fn(client);
        calls.push("COMMIT");
        return result;
      },
    } as any;
    return { client, calls };
  }

  describe("batched schema introspection", () => {
    it("answers many probes from ONE introspection pass, not one query each", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { pgTableExists, pgColumnExists, pgIndexExists } =
        await import("./ddl-guard.js");
      const { client, calls } = introspectingClient({
        tables: { settings: ["key", "value"], resources: ["id", "path"] },
        indexes: ["settings_updated_at_idx"],
      });

      expect(await pgTableExists("settings", client)).toBe(true);
      expect(await pgTableExists("resources", client)).toBe(true);
      expect(await pgColumnExists("settings", "value", client)).toBe(true);
      expect(await pgIndexExists("settings_updated_at_idx", client)).toBe(true);

      // A snapshot MISS is authoritative — absent, not "unknown".
      expect(await pgTableExists("not_a_table", client)).toBe(false);
      expect(await pgColumnExists("settings", "nope", client)).toBe(false);
      expect(await pgIndexExists("nope_idx", client)).toBe(false);

      // Two queries total, no matter how many probes ran.
      expect(calls).toHaveLength(2);
      expect(calls.filter((c) => /information_schema/.test(c))).toHaveLength(1);
      expect(calls.filter((c) => /pg_indexes/.test(c))).toHaveLength(1);
    });

    it("matches identifiers case-insensitively", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { pgTableExists, pgColumnExists } = await import("./ddl-guard.js");
      const { client } = introspectingClient({
        tables: { settings: ["updated_at"] },
      });
      expect(await pgTableExists("SETTINGS", client)).toBe(true);
      expect(await pgColumnExists("Settings", "Updated_At", client)).toBe(true);
    });

    it("does NOT share one client's schema with another client", async () => {
      // The hosted gateway probes a different app's database from the same
      // process. A shared Set would answer one app with another app's schema.
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { pgTableExists } = await import("./ddl-guard.js");
      const appA = introspectingClient({ tables: { only_in_a: ["id"] } });
      const appB = introspectingClient({ tables: { only_in_b: ["id"] } });

      expect(await pgTableExists("only_in_a", appA.client)).toBe(true);
      expect(await pgTableExists("only_in_a", appB.client)).toBe(false);
      expect(await pgTableExists("only_in_b", appB.client)).toBe(true);
      expect(await pgTableExists("only_in_b", appA.client)).toBe(false);
    });

    it("falls back to per-object probes when introspection is unreadable", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { pgTableExists } = await import("./ddl-guard.js");
      const calls: string[] = [];
      const client = {
        execute: async (sql: string | { sql: string; args?: unknown[] }) => {
          const text = typeof sql === "string" ? sql : sql.sql;
          calls.push(text);
          if (/information_schema\.columns|pg_indexes/.test(text)) {
            if (!/table_name = /.test(text)) {
              throw new Error("permission denied for information_schema");
            }
          }
          return { rows: [{ ok: 1 }], rowsAffected: 0 };
        },
      } as any;

      // Unreadable introspection must NOT be read as "the schema is empty" —
      // that would send every store down the DDL path it does not need.
      expect(await pgTableExists("settings", client)).toBe(true);
      expect(calls.some((c) => /table_name = /.test(c))).toBe(true);
    });

    it("re-reads the snapshot after DDL creates an object", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { ensureTableExists, pgTableExists } =
        await import("./ddl-guard.js");
      let created = false;
      const calls: string[] = [];
      const client = {
        execute: async (sql: string | { sql: string; args?: unknown[] }) => {
          const text = typeof sql === "string" ? sql : sql.sql;
          calls.push(text);
          if (/FROM information_schema\.columns/.test(text)) {
            return {
              rows: created ? [{ table_name: "late", column_name: "id" }] : [],
              rowsAffected: 0,
            };
          }
          if (/FROM pg_indexes/.test(text))
            return { rows: [], rowsAffected: 0 };
          if (/CREATE TABLE/.test(text)) created = true;
          return { rows: [], rowsAffected: 0 };
        },
        transaction: async (fn: (tx: any) => Promise<unknown>) => fn(client),
      } as any;

      expect(
        await ensureTableExists("late", `CREATE TABLE late (id TEXT)`, {
          injectedClient: client,
          dialectIsPostgres: true,
        }),
      ).toBe(true);
      // A sibling probe in the same boot must see it, not the pre-DDL snapshot.
      expect(await pgTableExists("late", client)).toBe(true);
    });
  });

  describe("AGENT_NATIVE_SKIP_ENSURE_TABLES", () => {
    it("reports every object present and issues NO query at all", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      vi.stubEnv("AGENT_NATIVE_SKIP_ENSURE_TABLES", "1");
      const { pgTableExists, pgColumnExists, pgIndexExists } =
        await import("./ddl-guard.js");
      const { client, calls } = introspectingClient({});

      expect(await pgTableExists("anything", client)).toBe(true);
      expect(await pgColumnExists("anything", "at_all", client)).toBe(true);
      expect(await pgIndexExists("any_idx", client)).toBe(true);
      expect(calls).toEqual([]);
    });

    it("makes ensureTableExists skip its DDL", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      vi.stubEnv("AGENT_NATIVE_SKIP_ENSURE_TABLES", "1");
      const { ensureTableExists } = await import("./ddl-guard.js");
      const { client, calls } = introspectingClient({});

      // `false` = "already present, no DDL issued".
      expect(
        await ensureTableExists("settings", `CREATE TABLE settings (k TEXT)`, {
          injectedClient: client,
          dialectIsPostgres: true,
        }),
      ).toBe(false);
      expect(calls).toEqual([]);
    });

    it("skips schema probes automatically in a production function", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NETLIFY_FUNCTION_NAME", "analytics");
      delete process.env.AGENT_NATIVE_SKIP_ENSURE_TABLES;
      const { ensureTableExists } = await import("./ddl-guard.js");
      const { client, calls } = introspectingClient({});

      await expect(
        ensureTableExists("settings", "CREATE TABLE settings (k TEXT)", {
          injectedClient: client,
          dialectIsPostgres: true,
        }),
      ).resolves.toBe(false);
      expect(calls).toEqual([]);
    });

    // The release runner is the only thing that CAN create schema on a hosted
    // deploy. If the skip applied to it too, `migrate:production` would report
    // success having created nothing — which is exactly how published sites came
    // up with an empty database.
    it("does NOT skip while the caller holds migration duty", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NETLIFY_FUNCTION_NAME", "analytics");
      delete process.env.AGENT_NATIVE_SKIP_ENSURE_TABLES;
      const { ensureTableExists } = await import("./ddl-guard.js");
      const { withMigrationRuntime } = await import("./migrations.js");
      const { client, calls } = introspectingClient({});

      // `true` = the table was genuinely missing and the DDL ran.
      await expect(
        withMigrationRuntime(() =>
          ensureTableExists("settings", "CREATE TABLE settings (k TEXT)", {
            injectedClient: client,
            dialectIsPostgres: true,
          }),
        ),
      ).resolves.toBe(true);
      expect(calls.length).toBeGreaterThan(0);
    });

    it("resumes skipping once migration duty is released", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NETLIFY_FUNCTION_NAME", "analytics");
      delete process.env.AGENT_NATIVE_SKIP_ENSURE_TABLES;
      const { ensureTableExists } = await import("./ddl-guard.js");
      const { withMigrationRuntime } = await import("./migrations.js");
      const { client, calls } = introspectingClient({});

      await withMigrationRuntime(async () => {});

      await expect(
        ensureTableExists("settings", "CREATE TABLE settings (k TEXT)", {
          injectedClient: client,
          dialectIsPostgres: true,
        }),
      ).resolves.toBe(false);
      expect(calls).toEqual([]);
    });

    it("is OFF unless explicitly enabled", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      for (const value of ["", "0", "false", "off"]) {
        vi.stubEnv("AGENT_NATIVE_SKIP_ENSURE_TABLES", value);
        vi.resetModules();
        const { pgTableExists } = await import("./ddl-guard.js");
        const { client, calls } = introspectingClient({});
        expect(await pgTableExists("nope", client)).toBe(false);
        expect(calls.length).toBeGreaterThan(0);
      }
    });
  });

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

    it("report valid and ready index existence on Postgres", async () => {
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
      expect(present.calls.some((sql) => /indisvalid/.test(sql))).toBe(true);
      expect(present.calls.some((sql) => /indisready/.test(sql))).toBe(true);

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

    it("keeps an unreadable information_schema distinct from an absent object", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { pgTableExists } = await import("./ddl-guard.js");
      const throwing = {
        execute: async () => {
          throw new Error("permission denied for relation");
        },
      } as any;
      expect(await pgTableExists("app_secrets", throwing)).toBeUndefined();
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
        // A worker killed mid-transaction never reaches COMMIT or ROLLBACK,
        // and the pooled connection returns to the pool still holding this
        // transaction's locks. Production had 11 of these stuck up to 283s,
        // each one last executing the SET LOCAL above, with ordinary queries
        // on that database degrading from ~1.5s to 5-7s. This is the only
        // part of the guard that still applies once the process is gone.
        "SET LOCAL idle_in_transaction_session_timeout = '30s'",
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

  describe("ensureSchemaObject (probe → guarded DDL → re-probe)", () => {
    it("does not issue DDL when the existence probe is unavailable", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { ensureSchemaObject } = await import("./ddl-guard.js");
      const { client, calls } = recordingClient();
      await expect(
        ensureSchemaObject({
          probe: async () => undefined,
          ddl: "ALTER TABLE resources ADD COLUMN thread_id TEXT",
          label: "column resources.thread_id",
          injectedClient: client,
        }),
      ).rejects.toThrow(/refusing to issue DDL/);
      expect(calls).toEqual([]);
    });

    it("skips DDL entirely when the object already exists (returns false)", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { ensureSchemaObject } = await import("./ddl-guard.js");
      const ddlCalls: string[] = [];
      const ran = await ensureSchemaObject({
        probe: async () => true,
        ddl: "CREATE TABLE foo (id TEXT)",
        label: "table foo",
        injectedClient: {
          execute: async (sql: string | { sql: string }) => {
            ddlCalls.push(typeof sql === "string" ? sql : sql.sql);
            return { rows: [], rowsAffected: 0 };
          },
          transaction: async (fn: (tx: any) => Promise<unknown>) => fn({}),
        } as any,
      });
      expect(ran).toBe(false);
      // No DDL was issued on the already-present hot path → no lock taken.
      expect(ddlCalls).toEqual([]);
    });

    it("runs DDL and resolves true when the object is missing", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { ensureSchemaObject } = await import("./ddl-guard.js");
      const { client, calls } = recordingClient();
      const ran = await ensureSchemaObject({
        probe: async () => false,
        ddl: "CREATE TABLE foo (id TEXT)",
        label: "table foo",
        injectedClient: client,
      });
      expect(ran).toBe(true);
      expect(calls).toContain("CREATE TABLE foo (id TEXT)");
    });

    it("resolves true when DDL lock-times out but a re-probe finds it present (race)", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { ensureSchemaObject } = await import("./ddl-guard.js");
      const lockErr = Object.assign(
        new Error("canceling statement due to lock timeout"),
        { code: "55P03" },
      );
      // First probe: missing. After the swallowed timeout, re-probe: present
      // (a concurrent connection created it meanwhile).
      let probeCount = 0;
      const probe = async () => {
        probeCount += 1;
        return probeCount > 1; // false first, true on re-probe
      };
      const client = {
        execute: async () => ({ rows: [], rowsAffected: 0 }),
        transaction: async (fn: (tx: any) => Promise<unknown>) =>
          fn({
            execute: async (sql: string | { sql: string }) => {
              const text = typeof sql === "string" ? sql : sql.sql;
              if (/CREATE TABLE/i.test(text)) throw lockErr;
              return { rows: [], rowsAffected: 0 };
            },
          }),
      } as any;
      const ran = await ensureSchemaObject({
        probe,
        ddl: "CREATE TABLE foo (id TEXT)",
        label: "table foo",
        injectedClient: client,
      });
      expect(ran).toBe(true);
      expect(probeCount).toBe(2);
    });

    it("THROWS (does not memoize success) when DDL lock-times out and the object is STILL missing", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { ensureSchemaObject } = await import("./ddl-guard.js");
      const lockErr = Object.assign(
        new Error("canceling statement due to lock timeout"),
        { code: "55P03" },
      );
      // Probe always reports missing — the lock-timed-out DDL truly didn't land.
      const client = {
        execute: async () => ({ rows: [], rowsAffected: 0 }),
        transaction: async (fn: (tx: any) => Promise<unknown>) =>
          fn({
            execute: async (sql: string | { sql: string }) => {
              const text = typeof sql === "string" ? sql : sql.sql;
              if (/CREATE TABLE/i.test(text)) throw lockErr;
              return { rows: [], rowsAffected: 0 };
            },
          }),
      } as any;
      await expect(
        ensureSchemaObject({
          probe: async () => false,
          ddl: "CREATE TABLE foo (id TEXT)",
          label: "table foo",
          injectedClient: client,
        }),
      ).rejects.toThrow(/still missing after a lock-timed-out DDL/);
    });

    it("rethrows a non-lock-timeout DDL error without re-probing", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
      const { ensureSchemaObject } = await import("./ddl-guard.js");
      let probeCount = 0;
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
        ensureSchemaObject({
          probe: async () => {
            probeCount += 1;
            return false;
          },
          ddl: "CREATE TABLE foo (id TEXT)",
          label: "table foo",
          injectedClient: client,
        }),
      ).rejects.toThrow("syntax error");
      // Only the initial probe ran; a hard DDL error doesn't trigger a re-probe.
      expect(probeCount).toBe(1);
    });

    it("ensureTableExists / ensureColumnExists / ensureIndexExists are no-ops on SQLite", async () => {
      vi.stubEnv("DATABASE_URL", "file:./data/app.db");
      const { ensureTableExists, ensureColumnExists, ensureIndexExists } =
        await import("./ddl-guard.js");
      // On SQLite the probes return false, so the wrappers run the DDL through
      // runGuardedDdl, which on SQLite just executes it directly (returns true).
      const { client, calls } = recordingClient();
      expect(
        await ensureTableExists("foo", "CREATE TABLE foo (id TEXT)", {
          injectedClient: client,
        }),
      ).toBe(true);
      expect(calls).toEqual(["CREATE TABLE foo (id TEXT)"]);
      expect(
        await ensureColumnExists(
          "foo",
          "bar",
          "ALTER TABLE foo ADD COLUMN bar TEXT",
          { injectedClient: client },
        ),
      ).toBe(true);
      expect(
        await ensureIndexExists("foo_idx", "CREATE INDEX foo_idx ON foo (id)", {
          injectedClient: client,
        }),
      ).toBe(true);
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

  it("creates concurrent indexes without opening a transaction", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
    const { ensureIndexExistsConcurrently } = await import("./ddl-guard.js");
    let created = false;
    const calls: string[] = [];
    const client = {
      execute: async (sql: string | { sql: string; args?: unknown[] }) => {
        const text = typeof sql === "string" ? sql : sql.sql;
        calls.push(text);
        if (/FROM information_schema\.columns/.test(text)) {
          return {
            rows: [{ table_name: "sync_events", column_name: "id" }],
            rowsAffected: 0,
          };
        }
        if (/FROM pg_indexes/.test(text)) {
          return {
            rows: created
              ? [{ indexname: "sync_events_created_at_id_idx" }]
              : [],
            rowsAffected: 0,
          };
        }
        if (/CREATE INDEX CONCURRENTLY/.test(text)) created = true;
        return { rows: [], rowsAffected: 0 };
      },
      transaction: async () => {
        throw new Error("concurrent index creation must not use a transaction");
      },
    } as any;

    await expect(
      ensureIndexExistsConcurrently(
        "sync_events_created_at_id_idx",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS sync_events_created_at_id_idx ON sync_events (created_at, id)",
        { injectedClient: client, dialectIsPostgres: true },
      ),
    ).resolves.toBe(true);
    expect(calls.some((sql) => /CREATE INDEX CONCURRENTLY/.test(sql))).toBe(
      true,
    );
    expect(calls).not.toContain("BEGIN");
  });
});
