import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let database: PGlite;

type QueryClient = { query(sql: string, args?: unknown[]): Promise<any> };
type Input = string | { sql: string; args?: unknown[] };

function queryParts(input: Input): { sql: string; args: unknown[] } {
  const sql = typeof input === "string" ? input : input.sql;
  const args = typeof input === "string" ? [] : (input.args ?? []);
  let index = 0;
  return {
    sql: sql.replace(/\?/g, () => `$${++index}`),
    args,
  };
}

const execute = vi.fn(
  async (input: Input, connection: QueryClient = database) => {
    const { sql, args } = queryParts(input);
    const result = await connection.query(sql, args);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowsAffected: result.affectedRows ?? 0,
    };
  },
);

const client = {
  execute(input: Input) {
    return execute(input);
  },
  async transaction<T>(run: (tx: typeof client) => Promise<T>): Promise<T> {
    return database.transaction(async (connection) =>
      run({
        execute(input) {
          return execute(input, connection);
        },
        transaction: client.transaction,
      }),
    );
  },
};

const ddlMocks = vi.hoisted(() => ({
  ensureIndexExists: vi.fn(),
  ensureTableExists: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => client,
}));

vi.mock("../db/ddl-guard.js", () => ddlMocks);

const {
  __resetAutomationSharingStoreForTests,
  deleteAutomationSharingStateWithDb,
  ensureAutomationSharingTables,
  getAutomationSharingState,
  loadAutomationSharingOverlays,
  prepareAutomationSharingDelete,
  prepareAutomationSharingReplacement,
  replaceAutomationSharingState,
} = await import("./sharing-store.js");

beforeEach(async () => {
  database = await PGlite.create("memory://");
  execute.mockReset();
  execute.mockImplementation(async (input, connection = database) => {
    const { sql, args } = queryParts(input);
    const result = await connection.query(sql, args);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowsAffected: result.affectedRows ?? 0,
    };
  });
  ddlMocks.ensureIndexExists.mockReset();
  ddlMocks.ensureTableExists.mockReset();
  ddlMocks.ensureIndexExists.mockImplementation(
    async (_name: string, sql: string) => client.execute(sql),
  );
  ddlMocks.ensureTableExists.mockImplementation(
    async (_name: string, sql: string) => client.execute(sql),
  );
  __resetAutomationSharingStoreForTests();
});

afterEach(async () => database.close());

describe("automation sharing store", () => {
  it("initializes the additive tables and indexes idempotently", async () => {
    await ensureAutomationSharingTables();
    await ensureAutomationSharingTables();

    const tables = await database.query(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'automation_sharing_%' ORDER BY tablename",
    );
    expect(tables.rows.map(({ name }) => name)).toEqual([
      "automation_sharing_grants",
      "automation_sharing_overlays",
    ]);

    const indexes = await database.query(
      "SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_automation_sharing_%' ORDER BY indexname",
    );
    expect(indexes.rows.map(({ name }) => name)).toEqual([
      "idx_automation_sharing_grants_user",
      "idx_automation_sharing_overlays_organization",
    ]);
  });

  it("uses guarded table and index creation on Postgres", async () => {
    ddlMocks.ensureIndexExists.mockResolvedValue(true);
    ddlMocks.ensureTableExists.mockResolvedValue(true);
    await ensureAutomationSharingTables();

    expect(ddlMocks.ensureTableExists).toHaveBeenCalledTimes(2);
    expect(ddlMocks.ensureIndexExists).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it("normalizes emails, enforces uniqueness, and replaces the complete state", async () => {
    await replaceAutomationSharingState("job-1", {
      kind: "specific",
      organizationId: " org-1 ",
      grants: [
        { email: " Alice@Example.com ", role: "view" },
        { email: "alice@example.com", role: "collaborate" },
        { email: "bob@example.com", role: "view" },
      ],
    });

    expect(await getAutomationSharingState("job-1")).toMatchObject({
      kind: "specific",
      visibility: "private",
      organizationId: "org-1",
      grants: [
        { email: "alice@example.com", role: "collaborate" },
        { email: "bob@example.com", role: "view" },
      ],
    });

    await replaceAutomationSharingState("job-1", {
      kind: "organization",
      organizationId: "org-1",
    });
    expect(await getAutomationSharingState("job-1")).toEqual({
      resourceId: "job-1",
      kind: "organization",
      visibility: "organization",
      organizationId: "org-1",
      grants: [],
    });
    const count = await database.query(
      "SELECT COUNT(*) AS count FROM automation_sharing_grants WHERE resource_id = $1",
      ["job-1"],
    );
    expect(count.rows[0]).toEqual({ count: 0 });
  });

  it("prepares guarded replacement and cleanup statements for a larger atomic batch", () => {
    const guard = {
      sql: "SELECT 1 FROM resources WHERE id = ? AND updated_at = ?",
      args: ["job-1", 10],
    };
    const replacement = prepareAutomationSharingReplacement(
      "job-1",
      {
        kind: "specific",
        grants: [{ email: "viewer@example.com", role: "view" }],
      },
      { now: 20, guard },
    );
    expect(replacement.statements).toHaveLength(4);
    expect(replacement.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sql: expect.stringContaining("EXISTS") }),
      ]),
    );
    expect(
      replacement.statements.every(
        (statement) =>
          typeof statement !== "string" && statement.args?.includes("job-1"),
      ),
    ).toBe(true);

    const cleanup = prepareAutomationSharingDelete("job-1", guard);
    expect(cleanup.statements).toHaveLength(2);
    expect(cleanup.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sql: expect.stringContaining("EXISTS") }),
      ]),
    );
  });

  it("cleans an automation's complete sharing state through the caller transaction", async () => {
    await replaceAutomationSharingState("job-1", {
      kind: "specific",
      grants: [{ email: "viewer@example.com", role: "view" }],
    });

    await client.transaction((tx) =>
      deleteAutomationSharingStateWithDb(tx, "job-1"),
    );

    expect(await getAutomationSharingState("job-1")).toBeNull();
  });

  it("loads resource overlays in bounded batches", async () => {
    await ensureAutomationSharingTables();
    for (let index = 0; index < 201; index++) {
      await database.query(
        "INSERT INTO automation_sharing_overlays (resource_id, visibility, organization_id, created_at, updated_at) VALUES ($1, 'private', NULL, 1, 1)",
        [`job-${index}`],
      );
    }
    execute.mockClear();

    const overlays = await loadAutomationSharingOverlays(
      Array.from({ length: 201 }, (_, index) => `job-${index}`),
    );

    expect(overlays).toHaveLength(201);
    const reads = execute.mock.calls.filter(([input]) =>
      /FROM automation_sharing_overlays WHERE resource_id IN/.test(
        typeof input === "string" ? input : input.sql,
      ),
    );
    expect(reads).toHaveLength(2);
  });

  it("rolls back a failed complete replacement", async () => {
    await replaceAutomationSharingState("job-1", {
      kind: "specific",
      grants: [{ email: "old@example.com", role: "view" }],
    });
    execute.mockImplementation(async (input, connection = database) => {
      const { sql, args } = queryParts(input);
      if (
        /INSERT INTO automation_sharing_grants/i.test(sql) &&
        args.includes("reject@example.com")
      ) {
        throw new Error("rejected test grant");
      }
      const result = await connection.query(sql, args);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.affectedRows ?? 0,
      };
    });

    await expect(
      replaceAutomationSharingState("job-1", {
        kind: "specific",
        grants: [{ email: "reject@example.com", role: "collaborate" }],
      }),
    ).rejects.toThrow("rejected test grant");

    expect(await getAutomationSharingState("job-1")).toMatchObject({
      kind: "specific",
      grants: [{ email: "old@example.com", role: "view" }],
    });
  });

  it("rejects incomplete or unsupported sharing state before writing", async () => {
    await expect(
      replaceAutomationSharingState("job-1", {
        kind: "specific",
        grants: [],
      }),
    ).rejects.toThrow("at least one grant");
    expect(await getAutomationSharingState("job-1")).toBeNull();
  });
});
