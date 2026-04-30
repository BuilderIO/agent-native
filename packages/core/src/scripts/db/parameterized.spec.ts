import { afterEach, describe, expect, it, vi } from "vitest";

describe("db scripts parameterized SQL", () => {
  afterEach(() => {
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
