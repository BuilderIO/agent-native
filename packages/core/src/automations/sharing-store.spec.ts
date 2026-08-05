import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;
let postgres = false;
let dialect: "sqlite" | "postgres" | "d1" = "sqlite";

const execute = vi.fn(
  async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : (input.args ?? []);
    const statement = sqlite.prepare(sql);
    if (/^\s*(select|pragma)/i.test(sql)) {
      return { rows: statement.all(...args), rowsAffected: 0 };
    }
    const result = statement.run(...args);
    return { rows: [], rowsAffected: result.changes };
  },
);

const client = {
  execute,
  async transaction<T>(run: (tx: typeof client) => Promise<T>): Promise<T> {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await run(client);
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};

const ddlMocks = vi.hoisted(() => ({
  ensureIndexExists: vi.fn().mockResolvedValue(true),
  ensureTableExists: vi.fn().mockResolvedValue(true),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => client,
  getDialect: () => dialect,
  isPostgres: () => postgres,
  retryOnDdlRace: (run: () => unknown) => run(),
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

beforeEach(() => {
  sqlite = new Database(":memory:");
  postgres = false;
  dialect = "sqlite";
  execute.mockClear();
  ddlMocks.ensureIndexExists.mockClear();
  ddlMocks.ensureTableExists.mockClear();
  __resetAutomationSharingStoreForTests();
});

afterEach(() => sqlite.close());

describe("automation sharing store", () => {
  it("initializes the additive tables and indexes idempotently", async () => {
    await ensureAutomationSharingTables();
    await ensureAutomationSharingTables();

    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'automation_sharing_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual([
      "automation_sharing_grants",
      "automation_sharing_overlays",
    ]);

    const indexes = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_automation_sharing_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map(({ name }) => name)).toEqual([
      "idx_automation_sharing_grants_user",
      "idx_automation_sharing_overlays_organization",
    ]);
  });

  it("uses guarded table and index creation on Postgres", async () => {
    postgres = true;
    dialect = "postgres";
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
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM automation_sharing_grants WHERE resource_id = ?",
        )
        .get("job-1"),
    ).toEqual({ count: 0 });
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
    const insert = sqlite.prepare(
      "INSERT INTO automation_sharing_overlays (resource_id, visibility, organization_id, created_at, updated_at) VALUES (?, 'private', NULL, 1, 1)",
    );
    for (let index = 0; index < 201; index++) insert.run(`job-${index}`);
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
    sqlite.exec(`
      CREATE TRIGGER reject_new_grant
      BEFORE INSERT ON automation_sharing_grants
      WHEN NEW.user_email = 'reject@example.com'
      BEGIN
        SELECT RAISE(ABORT, 'rejected test grant');
      END
    `);

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
