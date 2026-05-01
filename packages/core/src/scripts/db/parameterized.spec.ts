import { afterEach, describe, expect, it, vi } from "vitest";

describe("db scripts parameterized SQL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  function mockSqliteClient(executeImpl: ReturnType<typeof vi.fn>) {
    vi.doMock("@libsql/client", () => ({
      createClient: () => ({
        execute: executeImpl,
        close: vi.fn(),
      }),
    }));
    vi.doMock("../../db/client.js", () => ({
      getDatabaseUrl: () => "file:test.db",
      getDatabaseAuthToken: () => undefined,
    }));
  }

  function mockPostgresClient(unsafe: ReturnType<typeof vi.fn>) {
    const end = vi.fn();
    const introspect = vi.fn(async () => [
      { table_name: "notes", column_name: "id" },
      { table_name: "notes", column_name: "owner_email" },
      { table_name: "notes", column_name: "org_id" },
      { table_name: "notes", column_name: "title" },
    ]);
    const tx = Object.assign(introspect, { unsafe });
    const pgSql = Object.assign(introspect, {
      unsafe,
      end,
      begin: async (fn: any) => fn(tx),
    });
    vi.doMock("postgres", () => ({
      default: () => pgSql,
    }));
    vi.doMock("../../db/client.js", () => ({
      getDatabaseUrl: () => "postgres://qa.example/db",
      getDatabaseAuthToken: () => undefined,
    }));
    return { pgSql, end };
  }

  it("passes db-query bind args through to libsql", async () => {
    const execute = vi.fn(async (input: unknown) => {
      if (typeof input === "object" && input) {
        return { rows: [["ada"]], columns: ["name"] };
      }
      return { rows: [], columns: [] };
    });
    mockSqliteClient(execute);

    const { default: dbQuery } = await import("./query.js");

    await dbQuery([
      "--sql",
      "SELECT ? AS name",
      "--args",
      JSON.stringify(["ada"]),
      "--format",
      "json",
    ]);

    expect(execute).toHaveBeenCalledWith({
      sql: "SELECT ? AS name",
      args: ["ada"],
    });
  });

  it("passes db-exec bind args through to libsql", async () => {
    const execute = vi.fn(async () => ({
      rows: [],
      columns: [],
      rowsAffected: 1,
      lastInsertRowid: undefined,
    }));
    mockSqliteClient(execute);

    const { default: dbExec } = await import("./exec.js");

    await dbExec([
      "--sql",
      "UPDATE notes SET title = ? WHERE id = ?",
      "--args",
      JSON.stringify(["New title", "note-1"]),
      "--format",
      "json",
    ]);

    expect(execute).toHaveBeenCalledWith({
      sql: "UPDATE notes SET title = ? WHERE id = ?",
      args: ["New title", "note-1"],
    });
  });

  it("executes db-exec statement batches in one SQLite transaction", async () => {
    const execute = vi.fn(async () => ({
      rows: [],
      columns: [],
      rowsAffected: 1,
      lastInsertRowid: undefined,
    }));
    mockSqliteClient(execute);

    const { default: dbExec } = await import("./exec.js");

    await dbExec([
      "--statements",
      JSON.stringify([
        {
          sql: "INSERT INTO notes (id, title) VALUES (?, ?)",
          args: ["note-1", "One"],
        },
        {
          sql: "UPDATE notes SET title = ? WHERE id = ?",
          args: ["Two", "note-1"],
        },
      ]),
      "--format",
      "json",
    ]);

    expect(execute).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(execute).toHaveBeenNthCalledWith(2, {
      sql: "INSERT INTO notes (id, title) VALUES (?, ?)",
      args: ["note-1", "One"],
    });
    expect(execute).toHaveBeenNthCalledWith(3, {
      sql: "UPDATE notes SET title = ? WHERE id = ?",
      args: ["Two", "note-1"],
    });
    expect(execute).toHaveBeenNthCalledWith(4, "COMMIT");
  });

  it("rejects ad-hoc schema changes through db-exec", async () => {
    const execute = vi.fn();
    mockSqliteClient(execute);

    const { default: dbExec } = await import("./exec.js");

    await expect(
      dbExec(["--sql", "ALTER TABLE notes DROP COLUMN title"]),
    ).rejects.toThrow("schema changes are not allowed through db-exec");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps SQLite bind args aligned after scoped db-exec predicates are injected", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "script+qa-alice@example.com");
    vi.stubEnv("AGENT_ORG_ID", "org-qa-1");

    const execute = vi.fn(async (input: unknown) => {
      if (typeof input === "string" && input.includes("sqlite_master")) {
        return { rows: [{ name: "notes" }], columns: [] };
      }
      if (typeof input === "string" && input.includes("PRAGMA table_info")) {
        return {
          rows: [
            { name: "id" },
            { name: "owner_email" },
            { name: "org_id" },
            { name: "title" },
          ],
          columns: [],
        };
      }
      return {
        rows: [],
        columns: [],
        rowsAffected: 1,
        lastInsertRowid: undefined,
      };
    });
    mockSqliteClient(execute);

    const { default: dbExec } = await import("./exec.js");

    await dbExec([
      "--sql",
      "UPDATE notes SET title = ? WHERE id = ?",
      "--args",
      JSON.stringify(["Scoped title", "note-qa-1"]),
      "--format",
      "json",
    ]);

    expect(execute).toHaveBeenCalledWith({
      sql: `UPDATE main."notes" SET title = ? WHERE owner_email = 'script+qa-alice@example.com' AND org_id = 'org-qa-1' AND (id = ?)`,
      args: ["Scoped title", "note-qa-1"],
    });
  });

  it("converts db-query question-mark binds to Postgres numbered binds outside string literals", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "script+qa-reader@example.com");
    const unsafe = vi.fn(async (sql: string) => {
      if (sql.includes("TEMPORARY VIEW")) return [];
      if (sql.startsWith("DROP VIEW")) return [];
      return [{ id: "note-qa-1" }];
    });
    const { end } = mockPostgresClient(unsafe);

    const { default: dbQuery } = await import("./query.js");

    await dbQuery([
      "--sql",
      "SELECT * FROM notes WHERE title = ? AND body = '?' AND id = ?",
      "--args",
      JSON.stringify(["Title", "note-qa-1"]),
      "--format",
      "json",
    ]);

    expect(unsafe).toHaveBeenCalledWith(
      `SELECT * FROM notes WHERE title = $1 AND body = '?' AND id = $2`,
      ["Title", "note-qa-1"],
    );
    expect(end).toHaveBeenCalled();
  });

  it("converts db-exec question-mark binds to Postgres numbered binds after ownership injection", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "script+qa-writer@example.com");
    vi.stubEnv("AGENT_ORG_ID", "org-qa-2");
    const unsafe = vi.fn(async (sql: string) => {
      if (sql.includes("TEMPORARY VIEW")) return [];
      if (sql.startsWith("DROP VIEW")) return [];
      return Object.assign([], { count: 1 });
    });
    mockPostgresClient(unsafe);

    const { default: dbExec } = await import("./exec.js");

    await dbExec([
      "--sql",
      "INSERT INTO notes (id, title) VALUES (?, ?)",
      "--args",
      JSON.stringify(["note-qa-2", "Draft"]),
      "--format",
      "json",
    ]);

    expect(unsafe).toHaveBeenCalledWith(
      `INSERT INTO notes (id, title, owner_email, org_id) VALUES ($1, $2, 'script+qa-writer@example.com', 'org-qa-2')`,
      ["note-qa-2", "Draft"],
    );
  });

  it("rejects non-array bind args", async () => {
    const execute = vi.fn();
    mockSqliteClient(execute);

    const { default: dbQuery } = await import("./query.js");

    await expect(
      dbQuery(["--sql", "SELECT 1", "--args", JSON.stringify({ bad: true })]),
    ).rejects.toThrow("--args must be a JSON array");
    expect(execute).not.toHaveBeenCalled();
  });
});
