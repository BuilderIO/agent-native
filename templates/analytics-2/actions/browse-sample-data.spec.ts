import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireOrg: vi.fn(async () => "sample-org"),
}));
vi.mock("./_semantic-helpers.js", () => ({
  requireSemanticOrg: auth.requireOrg,
}));

import { sampleQuery } from "../server/model/sample-query.js";
import browseSampleData from "./browse-sample-data.js";

describe("built-in sample data browser", () => {
  it("lists schemas and tables, then reads complete preview rows and column metadata", async () => {
    const catalog = await browseSampleData.run({}, {} as never);
    expect(auth.requireOrg).toHaveBeenCalled();
    expect(catalog.schemas).toEqual(["PUBLIC"]);
    expect(catalog.tables.map((table) => table.name)).toEqual([
      "orders",
      "customers",
      "products",
      "sessions",
      "support_tickets",
    ]);
    expect(catalog.preview).toBeNull();
    const result = await browseSampleData.run({ table: "orders" }, {} as never);
    expect(result.preview?.rows).toHaveLength(240);
    expect(
      result.preview?.columns.map((column) => [column.name, column.dataType]),
    ).toEqual([
      ["order_id", "TEXT"],
      ["order_date", "DATE"],
      ["customer_id", "TEXT"],
      ["product_id", "TEXT"],
      ["quantity", "NUMERIC"],
      ["unit_price", "NUMERIC"],
      ["order_total", "NUMERIC"],
      ["channel", "TEXT"],
    ]);
    expect(result.preview?.rows[0]?.order_id).toBe("ord_0001");
    expect(result.preview?.complete).toBe(true);
    const reopened = await browseSampleData.run(
      { table: "orders" },
      {} as never,
    );
    expect(reopened).toEqual(result);
  });

  it("previews exactly the same five tables, types and rows as qualified SQL", async () => {
    const catalog = await browseSampleData.run({}, {} as never);
    for (const entry of catalog.tables) {
      const input = browseSampleData.schema.parse({ table: entry.name });
      const result = await browseSampleData.run(input, {} as never);
      const query = sampleQuery(`select * from PUBLIC.${entry.name}`);
      expect(query, entry.name).not.toBeNull();
      expect(query?.output.rowCount).toBe(entry.rowCount);
      expect(result.preview?.rows).toEqual(
        query?.output.rows.map((row) =>
          Object.fromEntries(
            query.output.columns.map((column, index) => [
              column.name,
              row[index],
            ]),
          ),
        ),
      );
    }
  });

  it("does not accept an arbitrary warehouse table or bypass membership", async () => {
    expect(
      browseSampleData.schema.safeParse({ table: "private.orders" }).success,
    ).toBe(false);
    auth.requireOrg.mockRejectedValueOnce(new Error("membership required"));
    await expect(browseSampleData.run({}, {} as never)).rejects.toThrow(
      "membership required",
    );
  });
});
