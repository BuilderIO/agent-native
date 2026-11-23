import { describe, expect, it } from "vitest";

import { referencedCteName, splitSqlCtes } from "./split-sql-ctes";

describe("splitSqlCtes", () => {
  it("returns null for queries without a WITH clause", () => {
    expect(splitSqlCtes("SELECT * FROM orders")).toBeNull();
    expect(splitSqlCtes("")).toBeNull();
  });

  it("splits multiple CTEs and the final SELECT", () => {
    const result = splitSqlCtes(`
      -- leading comment
      WITH active_orders AS (
        SELECT id, customer_id, total
        FROM orders
        WHERE status = 'active'
      ),
      customer_totals AS (
        SELECT customer_id, SUM(total) AS spend
        FROM active_orders
        GROUP BY customer_id
      )
      SELECT * FROM customer_totals ORDER BY spend DESC
    `);
    expect(result).toEqual({
      ctes: [
        {
          name: "active_orders",
          sql: "SELECT id, customer_id, total\n        FROM orders\n        WHERE status = 'active'",
        },
        {
          name: "customer_totals",
          sql: "SELECT customer_id, SUM(total) AS spend\n        FROM active_orders\n        GROUP BY customer_id",
        },
      ],
      finalSql: "SELECT * FROM customer_totals ORDER BY spend DESC",
    });
  });

  it("handles parens inside string literals and comments", () => {
    const result = splitSqlCtes(`
      WITH cleaned AS (
        SELECT ')' AS paren, /* ) */ 1 AS n
        FROM raw_table
      )
      SELECT * FROM cleaned
    `);
    expect(result?.ctes).toHaveLength(1);
    expect(result?.ctes[0]?.name).toBe("cleaned");
    expect(result?.finalSql).toBe("SELECT * FROM cleaned");
  });

  it("identifies when a later CTE references an earlier CTE", () => {
    expect(
      referencedCteName("SELECT * FROM active_orders", ["active_orders"]),
    ).toBe("active_orders");
    expect(referencedCteName("SELECT * FROM orders", ["active_orders"])).toBe(
      null,
    );
  });
});
