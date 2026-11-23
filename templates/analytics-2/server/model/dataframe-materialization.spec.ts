import { describe, expect, it } from "vitest";

import { sqlCellContentsSchema } from "../../app/lib/model/contracts.js";
import {
  collectDataframePages,
  dataframeSnapshot,
  storeDataframe,
} from "./dataframe-materialization.js";

const page = {
  columns: [{ name: "id", type: "INTEGER" }],
  rows: [["1"]],
  jobComplete: true,
  hasNextPage: true,
  pageToken: "next",
  totalRows: "2",
};

describe("warehouse dataframe collection", () => {
  it("rejects invalid private SQL type metadata before storage", async () => {
    for (const column of [
      { name: "value", type: "number", sqlType: "numeric" },
      { name: "value", type: "string", sqlType: "float" },
    ]) {
      await expect(
        storeDataframe(
          {
            type: "table",
            columns: [column],
            rows: [["1"]],
            rowCount: 1,
            truncated: false,
          } as never,
          "owner@example.test",
        ),
      ).rejects.toMatchObject({
        errorCode: "project_dataframe_materialization_failed",
      });
    }
  });
  it("collects all pages of a job and preserves typed values", async () => {
    const result = await collectDataframePages(page, async () => ({
      ...page,
      rows: [["2"]],
      hasNextPage: false,
      pageToken: null,
    }));
    expect(result.rows).toEqual([[1], [2]]);
    expect(result.truncated).toBe(false);
  });

  it("rejects oversized bytes and a final page that omits rows", async () => {
    await expect(
      collectDataframePages(
        {
          ...page,
          columns: [{ name: "value", type: "STRING" }],
          rows: [["x".repeat(8 * 1024 * 1024)]],
          hasNextPage: false,
          pageToken: null,
          totalRows: "1",
        },
        async () => {
          throw new Error("unexpected page");
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "project_dataframe_materialization_failed",
    });
    await expect(
      collectDataframePages({ ...page, totalRows: "3" }, async () => ({
        ...page,
        rows: [["2"]],
        totalRows: "3",
        hasNextPage: false,
        pageToken: null,
      })),
    ).rejects.toMatchObject({
      errorCode: "project_dataframe_materialization_failed",
    });
  });

  it("rejects incomplete, oversized, and unsafe results", async () => {
    for (const input of [
      { ...page, pageToken: null },
      { ...page, rows: Array.from({ length: 10001 }, () => ["1"]) },
      { ...page, rows: [["9007199254740993"]] },
      { ...page, columns: [{ name: "id", type: "JSON" }] },
    ]) {
      await expect(
        collectDataframePages(input, async () => {
          throw new Error("unexpected page");
        }),
      ).rejects.toMatchObject({
        errorCode: "project_dataframe_materialization_failed",
      });
    }
  });
});

describe("rotating continuation handles", () => {
  const rotating = (jobIdentity?: string, token: string | null = "t2") => ({
    ...page,
    ...(jobIdentity === undefined ? {} : { jobIdentity }),
    jobReference: { projectId: "p", jobId: token ?? "t1" },
  });
  it("accepts a rotating handle only under one stable provider identity", async () => {
    const last = {
      ...rotating("job"),
      rows: [["2"]],
      hasNextPage: false,
      pageToken: null,
    };
    const table = await collectDataframePages(
      { ...rotating("job"), pageToken: "t2" },
      async (_token, previous) => {
        expect(previous.jobReference?.jobId).toBe("t2");
        return last;
      },
    );
    expect(table.rows).toEqual([[1], [2]]);
    for (const next of [
      { ...last, jobIdentity: "other" },
      (({ jobIdentity: _omitted, ...rest }) => rest)(last),
    ])
      await expect(
        collectDataframePages(
          { ...rotating("job"), pageToken: "t2" },
          async () => next,
        ),
      ).rejects.toMatchObject({
        errorCode: "project_dataframe_materialization_failed",
      });
  });
  it("still requires an identical jobReference when no stable identity exists", async () => {
    await expect(
      collectDataframePages(rotating(), async () => ({
        ...rotating(undefined, "t3"),
        hasNextPage: false,
        pageToken: null,
      })),
    ).rejects.toMatchObject({
      errorCode: "project_dataframe_materialization_failed",
    });
  });
  it("rejects a repeated continuation cursor", async () => {
    await expect(
      collectDataframePages(
        { ...rotating("job"), pageToken: "t2" },
        async () => ({
          ...rotating("job"),
          pageToken: "t2",
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "project_dataframe_materialization_failed",
    });
  });
});

describe("dataframe snapshot", () => {
  it("ignores presentation and order changes but binds SQL execution", () => {
    const contents = sqlCellContentsSchema.parse({
      id: "cell-source",
      order: "a1",
      kind: "sql",
      source: "select 1",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      dataConnectionId: "connection",
      databaseSchema: null,
      resultVariable: "source",
      outputResult: true,
    });
    const hash = (value: typeof contents) =>
      dataframeSnapshot(
        "version",
        [{ id: contents.id, contents: value }],
        contents.id,
      );
    expect(
      hash({ ...contents, label: "renamed", order: "a2", hidden: true }),
    ).toBe(hash(contents));
    expect(hash({ ...contents, source: "select 2" })).not.toBe(hash(contents));
  });
});

describe("warehouse numeric dataframe execution", () => {
  it("preserves decimal aliases as exact text and rejects invalid or already rounded inputs", async () => {
    for (const type of ["NUMERIC", "BIGNUMERIC", "DECIMAL", "BIGDECIMAL"]) {
      const first = {
        ...page,
        columns: [{ name: "amount", type }],
        rows: [["0.1"]],
        hasNextPage: false,
        pageToken: null,
        totalRows: "1",
      };
      const next = async () => {
        throw new Error("unexpected page");
      };
      expect((await collectDataframePages(first, next)).rows).toEqual([
        ["0.1"],
      ]);
      for (const value of ["NaN", "1x", 0.1, 9007199254740992]) {
        await expect(
          collectDataframePages({ ...first, rows: [[value]] }, next),
        ).rejects.toMatchObject({
          errorCode: "project_dataframe_materialization_failed",
        });
      }
    }
  });

  it.each(["FLOAT", "FLOAT64", "DOUBLE", "REAL"])(
    "executes finite %s values as floating-point SQL alongside exact decimals",
    async (type) => {
      const { executeSampleTablesQuery } = await import("./sample-query.js");
      const snapshot = await collectDataframePages(
        {
          columns: [
            { name: "amount", type },
            { name: "exact", type: "NUMERIC" },
          ],
          rows: [
            ["1.25", "123456789.123456789"],
            [2.5, "0.1"],
          ],
          jobComplete: true,
          hasNextPage: false,
          pageToken: null,
          totalRows: "2",
        },
        async () => {
          throw new Error("unexpected page");
        },
      );
      const result = await executeSampleTablesQuery(
        "select pg_typeof(amount)::text, amount * 2, exact + 0.000000001 from warehouse order by amount",
        [{ name: "warehouse", columns: snapshot.columns, rows: snapshot.rows }],
      );
      expect(result?.output.rows).toEqual([
        ["double precision", 2.5, "123456789.123456790"],
        ["double precision", 5, "0.100000001"],
      ]);
    },
  );

  it.each(["FLOAT", "FLOAT64", "DOUBLE", "REAL"])(
    "rejects non-finite and invalid %s values",
    async (type) => {
      for (const value of [
        NaN,
        Infinity,
        -Infinity,
        "NaN",
        "Infinity",
        "-Infinity",
        "",
        " 1.2",
        "0x10",
        "1e999",
        "1x",
      ]) {
        await expect(
          collectDataframePages(
            {
              ...page,
              columns: [{ name: "amount", type }],
              rows: [[value]],
              hasNextPage: false,
              pageToken: null,
              totalRows: "1",
            },
            async () => {
              throw new Error("unexpected page");
            },
          ),
        ).rejects.toMatchObject({
          errorCode: "project_dataframe_materialization_failed",
        });
      }
    },
  );

  it("queries exact decimals from a complete warehouse snapshot", async () => {
    const { executeSampleTablesQuery } = await import("./sample-query.js");
    const snapshot = await collectDataframePages(
      {
        columns: [{ name: "amount", type: "NUMERIC" }],
        rows: [["123456789.123456789"]],
        jobComplete: true,
        hasNextPage: false,
        pageToken: null,
        totalRows: "1",
      },
      async () => {
        throw new Error("unexpected page");
      },
    );
    const result = await executeSampleTablesQuery(
      "select amount + 0.000000001 as adjusted, 0.1::numeric as small from warehouse",
      [{ name: "warehouse", columns: snapshot.columns, rows: snapshot.rows }],
    );
    expect(result?.output.rows).toEqual([["123456789.123456790", "0.1"]]);
  });
});
