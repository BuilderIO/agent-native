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

const { runDbAdminFederatedRead } =
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
            { user_id: 1, total: 10 },
            { user_id: 1, total: 15 },
          ],
          rowsAffected: 0,
          durationMs: 1,
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
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
          leftSourceId: "users",
          leftColumn: "id",
          rightSourceId: "orders",
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
});
