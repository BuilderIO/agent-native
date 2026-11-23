// A new workspace has sample projects whose SQL cells name the bundled sample
// tables and carry no connection. This is the evaluator that makes those cells
// run, and the boundary that keeps it from answering a real warehouse query.
import { describe, expect, it } from "vitest";

import {
  executeSampleQuery,
  namesSampleTable,
  sampleQuery,
  stripStatementTerminator,
} from "./sample-query.js";

describe("sample-data SQL", () => {
  it("report A2-CONSTANT-SQL-READBACK", async () => {
    const result = await executeSampleQuery(
      "SELECT 'one' AS label, 1 AS value",
    );
    expect(result?.output).toMatchObject({
      columns: [
        { name: "label", type: "string" },
        { name: "value", type: "number" },
      ],
      rows: [["one", 1]],
      rowCount: 1,
      truncated: false,
    });
    expect(
      (await executeSampleQuery("select $1::integer + 1 as value", [2]))?.output
        .rows,
    ).toEqual([[3]]);
    expect(
      (
        await executeSampleQuery(
          "with x as (select 1 as value) select * from x",
        )
      )?.output.rows,
    ).toEqual([[1]]);
    expect(await executeSampleQuery("select * from unknown_table")).toBeNull();
    await expect(
      executeSampleQuery("delete from orders"),
    ).rejects.toMatchObject({
      errorCode: "project_sample_query_failed",
      statusCode: 422,
    });
    expect(await executeSampleQuery("select * from private.orders")).toBeNull();
  });

  it("Steve demo: aggregates monthly revenue from the sample orders", async () => {
    const result = await executeSampleQuery(
      "-- Monthly revenue\n/* Group by month */ SELECT date_trunc('month', order_date) AS month, sum(order_total) AS revenue FROM orders GROUP BY 1 ORDER BY 1",
    );
    if (!result)
      throw new Error("Monthly sample query did not return a result");
    expect(result.output.columns.map((column) => column.name)).toEqual([
      "month",
      "revenue",
    ]);
    expect(result.output.rows.length).toBeGreaterThan(1);
    const raw = sampleQuery("select order_date, order_total from orders");
    if (!raw) throw new Error("Sample orders query did not return a result");
    const totals = new Map<string, number>();
    for (const [date, total] of raw.output.rows) {
      const month = String(date).slice(0, 7);
      totals.set(month, (totals.get(month) ?? 0) + Number(total));
    }
    expect(
      result.output.rows.map(([month, revenue]) => [
        String(month).slice(0, 7),
        Number(revenue).toFixed(2),
      ]),
    ).toEqual(
      [...totals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, revenue]) => [month, revenue.toFixed(2)]),
    );
  });

  it("terminates a demo query that exceeds its deadline", async () => {
    const start = Date.now();
    await expect(
      executeSampleQuery("select pg_sleep(30) from orders limit 1"),
    ).rejects.toMatchObject({ errorCode: "project_sample_query_timeout" });
    expect(Date.now() - start).toBeLessThan(19000);
    const next = await executeSampleQuery(
      "select count(*) as total from orders",
    );
    expect(next?.output.rows).toEqual([[240]]);
  });

  it("runs a monthly aggregation in a CTE over the quoted demo table", async () => {
    const result = await executeSampleQuery(
      `with monthly as (select date_trunc('month', order_date) as month, sum(order_total) as revenue from "public"."orders" group by 1) select * from monthly order by month`,
    );
    expect(result?.output.rows.length).toBeGreaterThan(1);
  });

  it("runs the sample project's own statement", () => {
    const result = sampleQuery(
      "select order_date, order_total, channel from orders order by order_date",
    );
    expect(result).not.toBeNull();
    expect(result!.output.columns.map((column) => column.name)).toEqual([
      "order_date",
      "order_total",
      "channel",
    ]);
    expect(result!.output.rowCount).toBeGreaterThan(0);
    const dates = result!.output.rows.map((row) => String(row[0]));
    expect(dates).toEqual([...dates].sort());
  });

  it("runs the other two seeded statements", () => {
    for (const sql of [
      "select customer_name, country, segment from customers",
      "select session_date, stage, users, conversions from sessions",
    ]) {
      const result = sampleQuery(sql);
      expect(result, sql).not.toBeNull();
      expect(result!.output.rowCount).toBeGreaterThan(0);
    }
  });

  it("projects a subset and honours a where clause and a limit", () => {
    const all = sampleQuery("select country, segment from customers")!;
    const countries = [
      ...new Set(all.output.rows.map((row) => String(row[0]))),
    ];
    const result = sampleQuery(
      `select segment from customers where country = '${countries[0]}' limit 3`,
    )!;
    expect(result.output.columns.map((column) => column.name)).toEqual([
      "segment",
    ]);
    expect(result.output.rowCount).toBeLessThanOrEqual(3);
    expect(result.output.rowCount).toBeGreaterThan(0);
  });

  it("selects every column for *", () => {
    const result = sampleQuery("select * from products")!;
    expect(result.output.columns.length).toBeGreaterThan(2);
  });

  it("accepts PUBLIC qualification without capturing other warehouse schemas", () => {
    expect(sampleQuery("select * from PUBLIC.orders limit 1")).toEqual(
      sampleQuery("select * from orders limit 1"),
    );
    expect(sampleQuery("select * from private.orders")).toBeNull();
    expect(namesSampleTable("select count(*) from PUBLIC.orders")).toBe(true);
    expect(
      namesSampleTable(
        "select * from public.support_tickets join public.orders on 1=1",
      ),
    ).toBe(true);
    expect(namesSampleTable("select * from private.orders")).toBe(false);
    expect(namesSampleTable("select * from orders_external")).toBe(false);
  });

  it("refuses anything that is not a query over a sample table", () => {
    for (const sql of [
      "select count(*) from orders",
      "select * from unknown_table",
      "select * from orders where missing = 1",
      "select * from orders join customers on 1 = 1",
      "delete from orders",
      "with x as (select 1) select * from x",
    ]) {
      expect(sampleQuery(sql), sql).toBeNull();
    }
  });
});

describe("statement terminators", () => {
  it("runs a statement followed by repeated semicolons or trailing comments", async () => {
    for (const sql of [
      "SELECT 1 AS a;;;",
      "SELECT 1 AS a; -- done",
      "SELECT 1 AS a; /* done */\n-- more\n",
    ])
      expect((await executeSampleQuery(sql))?.output.rows).toEqual([[1]]);
  });

  it("keeps semicolons that are not terminators", () => {
    expect(stripStatementTerminator("SELECT 'a;b' AS s;")).toBe(
      "SELECT 'a;b' AS s",
    );
    expect(stripStatementTerminator("SELECT 1; SELECT 2")).toBe(
      "SELECT 1; SELECT 2",
    );
  });
});

describe("sample query result values", () => {
  it("keeps 64-bit integers and long decimals exact by returning them as text", async () => {
    const result = await executeSampleQuery(
      "select 9223372036854775807::bigint as big, 1234567890123456789.123::numeric as dec, 42::bigint as small, 1.5::numeric as half",
    );
    expect(result?.output.columns.map((column) => column.type)).toEqual([
      "string",
      "string",
      "number",
      "number",
    ]);
    expect(result?.output.rows).toEqual([
      ["9223372036854775807", "1234567890123456789.123", 42, "1.5"],
    ]);
  });

  it("returns NaN and Infinity as text instead of failing the query", async () => {
    const result = await executeSampleQuery(
      "select 'NaN'::float as n, 'Infinity'::float as i, 'NaN'::numeric as d",
    );
    expect(result?.output.columns.map((column) => column.type)).toEqual([
      "string",
      "string",
      "string",
    ]);
    expect(result?.output.rows).toEqual([["NaN", "Infinity", "NaN"]]);
  });

  it("renders json, arrays and bytea as text", async () => {
    const result = await executeSampleQuery(
      `select '{"a":1}'::json as j, '{"b":[1,2]}'::jsonb as jb, array[1,2,3] as a, '\\xdead'::bytea as b`,
    );
    expect(result?.output.rows).toEqual([
      ['{"a":1}', '{"b": [1, 2]}', "[1,2,3]", "\\xdead"],
    ]);
  });
});

describe("sample query statements and errors", () => {
  it("runs a statement whose string literal or comment contains a semicolon", async () => {
    expect(
      (await executeSampleQuery("select 'a;b' as s"))?.output.rows,
    ).toEqual([["a;b"]]);
    expect(
      (await executeSampleQuery("select $$a;b$$ as s;"))?.output.rows,
    ).toEqual([["a;b"]]);
    expect(
      (await executeSampleQuery("select $tag$a;b$tag$ as s;"))?.output.rows,
    ).toEqual([["a;b"]]);
    expect(
      (await executeSampleQuery("select 1 as n -- first; second"))?.output.rows,
    ).toEqual([[1]]);
  });

  it("rejects several statements with a clear message", async () => {
    await expect(
      executeSampleQuery("select 1; select 2"),
    ).rejects.toMatchObject({
      message: "Only one SQL statement can run at a time.",
      errorCode: "project_sample_query_failed",
    });
  });

  it("does not leak the internal wrapper in a syntax error", async () => {
    const error = await executeSampleQuery("select 'abc").catch(
      (caught: Error) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/sample_result|LIMIT 10001/);
    expect((error as Error).message).toMatch(/unterminated quoted string/);
  });

  it("stops a running query as soon as its signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const started = Date.now();
    setTimeout(() => controller.abort(reason), 1500);
    await expect(
      executeSampleQuery(
        "select pg_sleep(30) from orders limit 1",
        [],
        false,
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(Date.now() - started).toBeLessThan(8000);
  });
});
