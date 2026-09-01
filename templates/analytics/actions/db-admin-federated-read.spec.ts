import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSql: vi.fn(),
  withDbAdminConnectionRuntime: vi.fn(),
}));

vi.mock("@agent-native/core/db-admin", () => ({
  runSql: mocks.runSql,
}));

vi.mock("../server/lib/db-admin-connections", () => ({
  withDbAdminConnectionRuntime: mocks.withDbAdminConnectionRuntime,
}));

const { federatedDbAdminReadSchema, runDbAdminFederatedRead } =
  await import("../server/lib/db-admin-federated-read");

describe("db-admin-federated-read", () => {
  beforeEach(() => {
    mocks.runSql.mockReset();
    mocks.withDbAdminConnectionRuntime.mockReset();
    mocks.withDbAdminConnectionRuntime.mockImplementation(
      async (_ctx, connectionId, fn) =>
        fn(
          { dialect: "sqlite", db: undefined } as any,
          { id: connectionId } as any,
        ),
    );
    mocks.runSql.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) {
        return {
          columns: ["id", "name"],
          rows: [
            { id: 1, name: "Ada" },
            { id: 2, name: "Bob" },
          ],
          rowsAffected: 0,
          durationMs: 1,
        };
      }
      if (sql.includes("FROM orders")) {
        return {
          columns: ["user_id", "total"],
          rows: [
            { user_id: "1", total: 10 },
            { user_id: "1", total: 15 },
          ],
          rowsAffected: 0,
          durationMs: 1,
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
  });

  it("rejects a join supplied with only one source", () => {
    expect(
      federatedDbAdminReadSchema.safeParse({
        sources: [{ connectionId: "conn-users", sql: "SELECT id FROM users" }],
        join: {
          kind: "inner",
          leftColumn: "id",
          rightColumn: "id",
        },
      }),
    ).toMatchObject({ success: false });
  });

  it("joins two read-only sources and keeps source metadata", async () => {
    const result = await runDbAdminFederatedRead(
      { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
      {
        sources: [
          {
            connectionId: "conn-users",
            sourceId: "users",
            sql: "SELECT id, name FROM users ORDER BY id",
          },
          {
            connectionId: "conn-orders",
            sourceId: "orders",
            sql: "SELECT user_id, total FROM orders ORDER BY user_id",
          },
        ],
        join: {
          kind: "inner",
          leftColumn: "id",
          rightColumn: "user_id",
        },
        projections: [
          { sourceId: "users", column: "name", as: "user_name" },
          { sourceId: "orders", column: "total" },
        ],
        limit: 10,
      },
    );

    expect(mocks.withDbAdminConnectionRuntime).toHaveBeenCalledTimes(2);
    expect(mocks.runSql).toHaveBeenCalledTimes(2);
    expect(
      mocks.runSql.mock.calls.every(([sql]) => /LIMIT 501$/.test(sql)),
    ).toBe(true);
    expect(result).toMatchObject({
      widget: "data-table",
      widgetId: "analytics.db-admin.federated-read.v1",
      summary: {
        sourceCount: 2,
        limit: 10,
        truncated: false,
        join: {
          kind: "inner",
          leftSourceId: "users",
          leftColumn: "id",
          rightSourceId: "orders",
          rightColumn: "user_id",
        },
      },
      table: {
        title: "Federated db admin result",
        columns: [
          { key: "user_name", label: "user_name" },
          { key: "total", label: "total", align: "right" },
        ],
        rows: [
          { user_name: "Ada", total: 10 },
          { user_name: "Ada", total: 15 },
        ],
        totalRows: 2,
      },
    });
  });

  it("uses a read-only transaction for Postgres sources", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 });
    const transaction = vi.fn(async (callback) => callback({ execute } as any));
    mocks.withDbAdminConnectionRuntime.mockImplementation(
      async (_ctx, connectionId, fn) =>
        fn(
          { dialect: "postgres", db: { transaction } } as any,
          { id: connectionId } as any,
        ),
    );

    await runDbAdminFederatedRead(
      { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
      {
        sources: [
          {
            connectionId: "conn-users",
            sourceId: "users",
            sql: "SELECT id, name FROM users",
          },
        ],
      },
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
  });

  it("prefixes rows for a single source when no projection is supplied", async () => {
    const result = await runDbAdminFederatedRead(
      { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
      {
        sources: [
          {
            connectionId: "conn-users",
            sourceId: "users",
            sql: "SELECT id, name FROM users",
          },
        ],
        limit: 10,
      },
    );

    expect(result.table.rows).toEqual([
      { "users.id": 1, "users.name": "Ada" },
      { "users.id": 2, "users.name": "Bob" },
    ]);
  });

  it("rejects write statements before executing them", async () => {
    await expect(
      runDbAdminFederatedRead(
        { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
        {
          sources: [
            {
              connectionId: "conn-users",
              sourceId: "users",
              sql: "DELETE FROM users",
            },
          ],
        },
      ),
    ).rejects.toThrow(/select or with/i);

    expect(mocks.runSql).not.toHaveBeenCalled();
  });

  it("rejects SELECT INTO before opening a database runtime", async () => {
    await expect(
      runDbAdminFederatedRead(
        { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
        {
          sources: [
            {
              connectionId: "conn-users",
              sourceId: "users",
              sql: "SELECT id INTO copied_users FROM users",
            },
          ],
        },
      ),
    ).rejects.toThrow(/select into/i);

    expect(mocks.withDbAdminConnectionRuntime).not.toHaveBeenCalled();
    expect(mocks.runSql).not.toHaveBeenCalled();
  });

  it("keeps right-side columns visible for unmatched left-join rows", async () => {
    mocks.runSql.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) {
        return {
          columns: ["id", "name"],
          rows: [
            { id: 1, name: "Ada" },
            { id: 2, name: "Bob" },
          ],
          rowsAffected: 0,
          durationMs: 1,
        };
      }
      return {
        columns: ["user_id", "total"],
        rows: [{ user_id: 1, total: 10 }],
        rowsAffected: 0,
        durationMs: 1,
      };
    });

    const result = await runDbAdminFederatedRead(
      { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
      {
        sources: [
          {
            connectionId: "conn-users",
            sourceId: "users",
            sql: "SELECT id, name FROM users",
          },
          {
            connectionId: "conn-orders",
            sourceId: "orders",
            sql: "SELECT user_id, total FROM orders",
          },
        ],
        join: {
          kind: "left",
          leftSourceId: "users",
          leftColumn: "id",
          rightSourceId: "orders",
          rightColumn: "user_id",
        },
        limit: 10,
      },
    );

    expect(result.table.rows).toEqual([
      {
        "users.id": 1,
        "users.name": "Ada",
        "orders.user_id": 1,
        "orders.total": 10,
      },
      {
        "users.id": 2,
        "users.name": "Bob",
        "orders.user_id": null,
        "orders.total": null,
      },
    ]);
  });

  it("allows an empty right source in a left join", async () => {
    mocks.runSql.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) {
        return {
          columns: ["id", "name"],
          rows: [{ id: 1, name: "Ada" }],
          rowsAffected: 0,
          durationMs: 1,
        };
      }
      return { columns: [], rows: [], rowsAffected: 0, durationMs: 1 };
    });

    const result = await runDbAdminFederatedRead(
      { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
      {
        sources: [
          {
            connectionId: "conn-users",
            sourceId: "users",
            sql: "SELECT id, name FROM users",
          },
          {
            connectionId: "conn-orders",
            sourceId: "orders",
            sql: "SELECT user_id, total FROM orders",
          },
        ],
        join: {
          kind: "left",
          leftColumn: "id",
          rightColumn: "user_id",
        },
        limit: 10,
      },
    );

    expect(result.summary).toMatchObject({ truncated: false });
    expect(result.table.rows).toEqual([{ "users.id": 1, "users.name": "Ada" }]);
  });

  it("normalizes timestamp strings and Date values to the same join key", async () => {
    mocks.runSql.mockImplementation(async (sql: string) =>
      sql.includes("FROM users")
        ? {
            columns: ["created_at", "name"],
            rows: [
              { created_at: new Date("2026-01-02T03:04:05.000Z"), name: "Ada" },
            ],
            rowsAffected: 0,
            durationMs: 1,
          }
        : {
            columns: ["created_at", "total"],
            rows: [{ created_at: "2026-01-02 03:04:05", total: 10 }],
            rowsAffected: 0,
            durationMs: 1,
          },
    );

    const result = await runDbAdminFederatedRead(
      { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
      {
        sources: [
          {
            connectionId: "conn-users",
            sourceId: "users",
            sql: "SELECT created_at, name FROM users",
          },
          {
            connectionId: "conn-orders",
            sourceId: "orders",
            sql: "SELECT created_at, total FROM orders",
          },
        ],
        join: {
          kind: "inner",
          leftColumn: "created_at",
          rightColumn: "created_at",
        },
        projections: [
          { sourceId: "users", column: "name", as: "user_name" },
          { sourceId: "orders", column: "total" },
        ],
      },
    );

    expect(result.table.rows).toEqual([{ user_name: "Ada", total: 10 }]);
  });

  it("rejects joins when a source contains previewed large cells", async () => {
    mocks.runSql.mockResolvedValue({
      columns: ["id", "payload"],
      rows: [{ id: 1, payload: "preview" }],
      rowsAffected: 0,
      durationMs: 1,
      truncatedCells: 1,
    });

    await expect(
      runDbAdminFederatedRead(
        { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
        {
          sources: [
            { connectionId: "conn-users", sql: "SELECT id FROM users" },
            { connectionId: "conn-orders", sql: "SELECT id FROM orders" },
          ],
          join: { kind: "inner", leftColumn: "id", rightColumn: "id" },
        },
      ),
    ).rejects.toThrow(/truncated large-cell/i);
  });

  it("reports the hard source cap as truncation", async () => {
    mocks.runSql.mockResolvedValue({
      columns: ["id"],
      rows: Array.from({ length: 501 }, (_, id) => ({ id })),
      rowsAffected: 0,
      durationMs: 1,
    });

    const result = await runDbAdminFederatedRead(
      { userEmail: "alice@example.com", orgId: "org_1", role: "admin" },
      {
        sources: [
          {
            connectionId: "conn-users",
            sourceId: "users",
            sql: "SELECT id FROM users LIMIT 999999",
          },
        ],
        limit: 500,
      },
    );

    expect(result.summary).toMatchObject({ truncated: true });
    expect(result.table.rows).toHaveLength(500);
    expect(result.table).toMatchObject({ sampledRows: 500, truncated: true });
  });
});
