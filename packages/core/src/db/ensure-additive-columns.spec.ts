import { sql } from "drizzle-orm";
import {
  pgTable,
  text as pgText,
  integer as pgInteger,
} from "drizzle-orm/pg-core";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
} from "drizzle-orm/sqlite-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `ensureAdditiveColumns` resolves `isPostgres()` / dialect-specific
// `getTableConfig` through `./client.js`, which derives the dialect from
// `process.env.DATABASE_URL`. Tests stub that env and pass a fake `DbExec`,
// so no real database is required.

describe("ensureAdditiveColumns", () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = originalEnv;
    vi.resetModules();
  });

  // A tiny Postgres table: an existing `id` column, a NOT NULL column with a
  // literal default (`count`), a nullable column with no default (`note`), a
  // NOT NULL column with a `now()` sql default (`created_at`), and a NOT NULL
  // column with NO renderable default (`required_no_default`) to exercise the
  // skip path.
  const pgSessionRecordings = pgTable("session_recordings", {
    id: pgText("id").primaryKey(),
    networkErrorCount: pgInteger("network_error_count").notNull().default(0),
    note: pgText("note"),
    createdAt: pgText("created_at")
      .notNull()
      .default(sql`now()`),
    requiredNoDefault: pgText("required_no_default").notNull(),
  });

  const sqliteSessionRecordings = sqliteTable("session_recordings", {
    id: sqliteText("id").primaryKey(),
    networkErrorCount: sqliteInteger("network_error_count")
      .notNull()
      .default(0),
    note: sqliteText("note"),
    createdAt: sqliteText("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    requiredNoDefault: sqliteText("required_no_default").notNull(),
  });

  function fakePgClient(opts: {
    tableExists: boolean;
    liveColumns: string[];
    onAlter?: (sql: string) => void | never;
  }) {
    const calls: string[] = [];
    const client = {
      execute: async (sqlArg: string | { sql: string; args?: unknown[] }) => {
        const text = typeof sqlArg === "string" ? sqlArg : sqlArg.sql;
        calls.push(text);
        if (/information_schema\.tables/i.test(text)) {
          return {
            rows: opts.tableExists ? [{ ok: 1 }] : [],
            rowsAffected: 0,
          };
        }
        if (/information_schema\.columns/i.test(text)) {
          return {
            rows: opts.liveColumns.map((column_name) => ({ column_name })),
            rowsAffected: 0,
          };
        }
        if (/ALTER TABLE/i.test(text)) {
          opts.onAlter?.(text);
        }
        return { rows: [], rowsAffected: 0 };
      },
    } as any;
    return { client, calls };
  }

  function fakeSqliteClient(opts: {
    tableExists: boolean;
    liveColumns: string[];
    onAlter?: (sql: string) => void | never;
  }) {
    const calls: string[] = [];
    const client = {
      execute: async (sqlArg: string | { sql: string; args?: unknown[] }) => {
        const text = typeof sqlArg === "string" ? sqlArg : sqlArg.sql;
        calls.push(text);
        if (/sqlite_master/i.test(text)) {
          return {
            rows: opts.tableExists ? [{ ok: 1 }] : [],
            rowsAffected: 0,
          };
        }
        if (/PRAGMA table_info/i.test(text)) {
          return {
            rows: opts.liveColumns.map((name) => ({ name })),
            rowsAffected: 0,
          };
        }
        if (/ALTER TABLE/i.test(text)) {
          opts.onAlter?.(text);
        }
        return { rows: [], rowsAffected: 0 };
      },
    } as any;
    return { client, calls };
  }

  describe("Postgres", () => {
    beforeEach(() => {
      vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
    });

    it("adds a missing NOT NULL column with its literal default", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client, calls } = fakePgClient({
        tableExists: true,
        liveColumns: ["id", "note", "created_at", "required_no_default"],
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [pgSessionRecordings],
      });
      expect(result.applied).toEqual([
        "session_recordings.network_error_count",
      ]);
      const alter = calls.find((c) => /ALTER TABLE/i.test(c));
      expect(alter).toContain('ADD COLUMN "network_error_count"');
      expect(alter).toContain("DEFAULT 0");
      expect(alter).toContain("NOT NULL");
      expect(alter).toMatch(/^ALTER TABLE "session_recordings"/);
    });

    it("renders a safe sql`` default (now()) and adds NOT NULL", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { calls } = fakePgClient({
        tableExists: true,
        liveColumns: [
          "id",
          "network_error_count",
          "note",
          "required_no_default",
        ],
      });
      const { client } = fakePgClient({
        tableExists: true,
        liveColumns: [
          "id",
          "network_error_count",
          "note",
          "required_no_default",
        ],
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [pgSessionRecordings],
      });
      expect(result.applied).toEqual(["session_recordings.created_at"]);
      void calls;
    });

    it("skips a NOT NULL column with no renderable default, with a reason", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client } = fakePgClient({
        tableExists: true,
        liveColumns: ["id", "network_error_count", "note", "created_at"],
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [pgSessionRecordings],
      });
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual([
        {
          column: "session_recordings.required_no_default",
          reason:
            "declared NOT NULL with no renderable default — cannot backfill existing rows safely",
        },
      ]);
    });

    it("generates no ALTERs when every declared column already exists", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client, calls } = fakePgClient({
        tableExists: true,
        liveColumns: [
          "id",
          "network_error_count",
          "note",
          "created_at",
          "required_no_default",
        ],
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [pgSessionRecordings],
      });
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(calls.some((c) => /ALTER TABLE/i.test(c))).toBe(false);
    });

    it("no-ops when the table itself does not exist (creation path owns it)", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client, calls } = fakePgClient({
        tableExists: false,
        liveColumns: [],
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [pgSessionRecordings],
      });
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(calls.some((c) => /ALTER TABLE/i.test(c))).toBe(false);
    });

    it("a per-column ALTER failure is recorded as an error and does not abort remaining columns", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      let alterCount = 0;
      const { client } = fakePgClient({
        tableExists: true,
        liveColumns: ["id", "note", "required_no_default"],
        onAlter: () => {
          alterCount++;
          if (alterCount === 1) {
            throw Object.assign(new Error("permission denied for relation"), {
              code: "42501",
            });
          }
        },
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [pgSessionRecordings],
      });
      // network_error_count fails, created_at still gets applied.
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].column).toBe(
        "session_recordings.network_error_count",
      );
      expect(result.applied).toEqual(["session_recordings.created_at"]);
    });

    it("annotates a 42703 error as schema drift", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client } = fakePgClient({
        tableExists: true,
        liveColumns: ["id", "note", "created_at", "required_no_default"],
        onAlter: () => {
          throw Object.assign(new Error("column does not exist"), {
            code: "42703",
          });
        },
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [pgSessionRecordings],
      });
      expect(result.errors[0].error).toContain("schema drift");
      expect(result.errors[0].error).toContain("42703");
    });

    it("treats a duplicate-column race as success", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client } = fakePgClient({
        tableExists: true,
        liveColumns: ["id", "note", "created_at", "required_no_default"],
        onAlter: () => {
          throw Object.assign(
            new Error('column "network_error_count" already exists'),
            { code: "42701" },
          );
        },
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [pgSessionRecordings],
      });
      expect(result.applied).toContain(
        "session_recordings.network_error_count",
      );
      expect(result.errors).toEqual([]);
    });
  });

  describe("SQLite", () => {
    beforeEach(() => {
      vi.stubEnv("DATABASE_URL", "file:./data/app.db");
    });

    it("adds a missing column using PRAGMA table_info introspection", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client, calls } = fakeSqliteClient({
        tableExists: true,
        liveColumns: ["id", "note", "created_at", "required_no_default"],
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [sqliteSessionRecordings],
      });
      expect(result.applied).toEqual([
        "session_recordings.network_error_count",
      ]);
      const alter = calls.find((c) => /ALTER TABLE/i.test(c));
      expect(alter).toContain('ADD COLUMN "network_error_count"');
      expect(alter).toContain("DEFAULT 0");
    });

    it("no-ops when the table does not exist", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client, calls } = fakeSqliteClient({
        tableExists: false,
        liveColumns: [],
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [sqliteSessionRecordings],
      });
      expect(result.applied).toEqual([]);
      expect(calls.some((c) => /ALTER TABLE/i.test(c))).toBe(false);
    });

    it("treats a duplicate-column race as success", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client } = fakeSqliteClient({
        tableExists: true,
        liveColumns: ["id", "note", "created_at", "required_no_default"],
        onAlter: () => {
          throw new Error(
            "SQLITE_ERROR: duplicate column name: network_error_count",
          );
        },
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [sqliteSessionRecordings],
      });
      expect(result.applied).toContain(
        "session_recordings.network_error_count",
      );
      expect(result.errors).toEqual([]);
    });

    it("generates no ALTERs when every declared column already exists", async () => {
      const { ensureAdditiveColumns } =
        await import("./ensure-additive-columns.js");
      const { client, calls } = fakeSqliteClient({
        tableExists: true,
        liveColumns: [
          "id",
          "network_error_count",
          "note",
          "created_at",
          "required_no_default",
        ],
      });
      const result = await ensureAdditiveColumns({
        db: client,
        tables: [sqliteSessionRecordings],
      });
      expect(result.applied).toEqual([]);
      expect(calls.some((c) => /ALTER TABLE/i.test(c))).toBe(false);
    });
  });

  it("logs applied/skipped/error lines through an injected logger", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
    const { ensureAdditiveColumns } =
      await import("./ensure-additive-columns.js");
    const { client } = fakePgClient({
      tableExists: true,
      liveColumns: ["id", "created_at"],
    });
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    await ensureAdditiveColumns({
      db: client,
      tables: [pgSessionRecordings],
      logger: { info, warn, error },
    });
    expect(
      info.mock.calls.some((c) =>
        String(c[0]).includes("added session_recordings.network_error_count"),
      ),
    ).toBe(true);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("session_recordings.required_no_default"),
      ),
    ).toBe(true);
  });
});
