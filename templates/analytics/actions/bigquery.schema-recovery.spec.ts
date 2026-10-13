import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(),
  getAccessToken: vi.fn(),
  getCredentialContext: vi.fn(),
  resolveCredential: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: vi.fn() }),
}));
vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
  getRequestRunContext: () => undefined,
}));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));
vi.mock("../server/lib/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));
vi.mock("../server/lib/gcloud", () => ({
  getAccessToken: mocks.getAccessToken,
  raceWithAbort: (value: unknown) => Promise.resolve(value),
}));
// The real lib answers metadata and table-list requests through the mocked
// fetch; only the query itself is stubbed.
vi.mock("../server/lib/bigquery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/bigquery")>()),
  runQuery: (sql: string, options?: unknown) => mocks.runQuery(sql, options),
}));

const { default: bigquery } = await import("./bigquery");
const { getBigQueryTableMetadata } = await import("../server/lib/bigquery");

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tableMetadata(tableId: string, columns: Array<[string, string]>) {
  return {
    tableReference: {
      projectId: "test-project",
      datasetId: "product",
      tableId,
    },
    schema: { fields: columns.map(([name, type]) => ({ name, type })) },
  };
}

const failedQuery = (detail: string) =>
  new Error(`BigQuery API error 400: ${detail} at [1:8]`);

const metadataFetches = () =>
  mocks.fetch.mock.calls.filter(([url]) =>
    /\/tables\/[^/?]+$/.test(String(url)),
  );

let tableSequence = 0;
/** The metadata cache outlives a test, so every test reads its own table. */
const freshTable = () => `signups_${(tableSequence += 1)}`;

beforeEach(() => {
  mocks.runQuery.mockReset();
  mocks.fetch.mockReset();
  mocks.getAccessToken.mockReset();
  mocks.getCredentialContext.mockReset();
  mocks.resolveCredential.mockReset();
  mocks.getAccessToken.mockResolvedValue("test-token");
  mocks.getCredentialContext.mockReturnValue({
    userEmail: "test@example.com",
    orgId: null,
  });
  mocks.resolveCredential.mockImplementation(async (key: string) =>
    key === "BIGQUERY_PROJECT_ID" ? "test-project" : null,
  );
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bigquery failed-query schema recovery", () => {
  it("answers an unrecognized column with the nearest real columns and the table's columns", async () => {
    const table = freshTable();
    mocks.runQuery.mockRejectedValue(
      failedQuery("Unrecognized name: event_time"),
    );
    mocks.fetch.mockResolvedValue(
      jsonResponse(
        tableMetadata(table, [
          ["user_id", "STRING"],
          ["event_timestamp", "TIMESTAMP"],
          ["plan", "STRING"],
          ["payload.region", "STRING"],
        ]),
      ),
    );

    const result = (await bigquery.run({
      sql: `SELECT event_time FROM \`test-project.product.${table}\``,
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: "bigquery_query_failed",
      message: "Unrecognized name: event_time at [1:8]",
      recoverable: true,
      table: `test-project.product.${table}`,
      didYouMean: ["event_timestamp"],
      columns: [
        "user_id:STRING",
        "event_timestamp:TIMESTAMP",
        "plan:STRING",
        "payload.region:STRING",
      ],
      columnCount: 4,
    });
    expect(result).not.toHaveProperty("schemaLookup");
    expect(String(result.hint)).toContain("didYouMean");
  });

  it("matches against every column and marks the bounded echoed list", async () => {
    const table = freshTable();
    mocks.runQuery.mockRejectedValue(
      failedQuery("Unrecognized name: event_timestamp"),
    );
    mocks.fetch.mockResolvedValue(
      jsonResponse(
        tableMetadata(
          table,
          Array.from(
            { length: 61 },
            (_, index) =>
              [
                index === 60 ? "event_timestamp" : `column_${index + 1}`,
                "STRING",
              ] as [string, string],
          ),
        ),
      ),
    );

    const result = (await bigquery.run({
      sql: `SELECT event_timestamp FROM \`test-project.product.${table}\``,
    })) as Record<string, unknown>;

    expect(result.didYouMean).toContain("event_timestamp");
    expect(result).toMatchObject({
      columnCount: 61,
      columnsTruncated: true,
    });
    expect(result.columns).toHaveLength(60);
  });

  it("reads the table out of a two-part reference and a join", async () => {
    const table = freshTable();
    mocks.runQuery.mockRejectedValue(failedQuery("Unrecognized name: planx"));
    mocks.fetch.mockImplementation(async (url: string) =>
      String(url).endsWith(`/tables/${table}`)
        ? jsonResponse(tableMetadata(table, [["plan", "STRING"]]))
        : jsonResponse({ error: { message: "Not found" } }, 404),
    );

    const result = (await bigquery.run({
      sql: `SELECT planx FROM product.${table} s JOIN product.missing_${table} m ON s.id = m.id`,
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      table: `test-project.product.${table}`,
      didYouMean: ["plan"],
      unreadTables: [`test-project.product.missing_${table}`],
    });
  });

  it("answers a missing table with the nearest tables of its dataset", async () => {
    mocks.runQuery.mockRejectedValue(
      failedQuery(
        "Not found: Table test-project:product.signup_events was not found in location US",
      ),
    );
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        tables: [
          { tableReference: { datasetId: "product", tableId: "signups" } },
          { tableReference: { datasetId: "product", tableId: "signup_event" } },
          { tableReference: { datasetId: "product", tableId: "revenue" } },
        ],
      }),
    );

    const result = (await bigquery.run({
      sql: "SELECT * FROM `test-project.product.signup_events`",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: "bigquery_query_failed",
      table: "product.signup_events",
      didYouMeanTables: ["product.signup_event", "product.signups"],
    });
    expect(result).not.toHaveProperty("schemaLookup");
  });

  it("keeps the original error and says the lookup failed when metadata cannot be read", async () => {
    const table = freshTable();
    mocks.runQuery.mockRejectedValue(
      failedQuery("Unrecognized name: event_time"),
    );
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: { message: "Access Denied" } }, 403),
    );

    const result = (await bigquery.run({
      sql: `SELECT event_time FROM \`test-project.product.${table}\``,
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: "bigquery_query_failed",
      message: "Unrecognized name: event_time at [1:8]",
      recoverable: true,
      schemaLookup: "failed",
    });
    expect(result).not.toHaveProperty("columns");
    expect(result).not.toHaveProperty("didYouMean");
    expect(String(result.hint)).toContain("search-bigquery-schema");
  });

  it("says the lookup was unavailable when the SQL names no table to look up", async () => {
    mocks.runQuery.mockRejectedValue(
      failedQuery("Unrecognized name: event_time"),
    );

    const result = (await bigquery.run({
      sql: "SELECT event_time FROM @app_events",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: "bigquery_query_failed",
      message: "Unrecognized name: event_time at [1:8]",
      schemaLookup: "unavailable",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not look up a schema for an error that is not a schema miss", async () => {
    mocks.runQuery.mockRejectedValue(
      failedQuery("Syntax error: Unexpected keyword FROM"),
    );

    const result = (await bigquery.run({
      sql: "SELECT FROM `test-project.product.signups`",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({ error: "bigquery_query_failed" });
    expect(result).not.toHaveProperty("schemaLookup");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reads fresh metadata on every column miss and refreshes the cache with it", async () => {
    const table = freshTable();
    mocks.runQuery.mockRejectedValue(
      failedQuery("Unrecognized name: event_time"),
    );
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse(
          tableMetadata(table, [
            ["event_timestamp", "TIMESTAMP"],
            ["legacy_ts", "TIMESTAMP"],
          ]),
        ),
      )
      .mockResolvedValue(
        jsonResponse(tableMetadata(table, [["event_timestamp", "TIMESTAMP"]])),
      );
    const sql = `SELECT event_time FROM \`test-project.product.${table}\``;

    await bigquery.run({ sql });
    const second = (await bigquery.run({ sql })) as Record<string, unknown>;
    const cached = await getBigQueryTableMetadata({
      projectId: "test-project",
      datasetId: "product",
      tableId: table,
    });

    expect(second).toMatchObject({ columns: ["event_timestamp:TIMESTAMP"] });
    expect(cached.schema?.fields).toHaveLength(1);
    expect(metadataFetches()).toHaveLength(2);
  });

  it("does not cache a failed metadata read", async () => {
    const table = freshTable();
    mocks.runQuery.mockRejectedValue(
      failedQuery("Unrecognized name: event_time"),
    );
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Backend" } }, 500),
      )
      .mockResolvedValue(
        jsonResponse(tableMetadata(table, [["event_timestamp", "TIMESTAMP"]])),
      );
    const sql = `SELECT event_time FROM \`test-project.product.${table}\``;

    const first = (await bigquery.run({ sql })) as Record<string, unknown>;
    const second = (await bigquery.run({ sql })) as Record<string, unknown>;

    expect(first).toMatchObject({ schemaLookup: "failed" });
    expect(second).toMatchObject({ didYouMean: ["event_timestamp"] });
    expect(metadataFetches()).toHaveLength(2);
  });

  it("reads the schema when the miss names the alias, not a bare column", async () => {
    const table = freshTable();
    mocks.runQuery.mockRejectedValue(
      failedQuery("Name event_time not found inside s"),
    );
    mocks.fetch.mockResolvedValue(
      jsonResponse(tableMetadata(table, [["event_timestamp", "TIMESTAMP"]])),
    );

    const result = (await bigquery.run({
      sql: `SELECT s.event_time FROM product.${table} s`,
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      table: `test-project.product.${table}`,
      didYouMean: ["event_timestamp"],
    });
    expect(result).not.toHaveProperty("schemaLookup");
  });

  describe("the lookup deadline", () => {
    it.each([
      [
        "an unrecognized column",
        "Unrecognized name: event_time",
        "SELECT event_time FROM `test-project.product.signups_deadline`",
      ],
      [
        "a missing table",
        "Not found: Table test-project:product.signup_events was not found in location US",
        "SELECT * FROM `test-project.product.signup_events`",
      ],
    ])(
      "answers %s within the deadline when the access token is slow",
      async (_name, detail, sql) => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        mocks.runQuery.mockRejectedValue(failedQuery(detail));
        // A token cache miss: the exchange retries Google for far longer than
        // the lookup is allowed to take.
        mocks.getAccessToken.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve("late-token"), 120_000);
            }),
        );
        let settled = false;
        const run = bigquery.run({ sql }).finally(() => {
          settled = true;
        });

        await vi.advanceTimersByTimeAsync(7_999);
        expect(settled).toBe(false);
        // The deadline, then the short grace a lookup stuck before its fetches
        // gets to settle.
        await vi.advanceTimersByTimeAsync(1_001);

        expect(settled).toBe(true);
        const result = (await run) as Record<string, unknown>;
        expect(result).toMatchObject({
          error: "bigquery_query_failed",
          message: `${detail} at [1:8]`,
          recoverable: true,
          schemaLookup: "failed",
        });
        expect(result).not.toHaveProperty("columns");
        expect(result).not.toHaveProperty("didYouMeanTables");
        expect(mocks.fetch).not.toHaveBeenCalled();
      },
    );

    // A fetch settles when its signal aborts, as the real one does.
    const hangUntilAborted = (init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });

    it("keeps the columns of the tables that answered when a sibling read hangs", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const [fast, hung] = ["signups_deadline_fast", "signups_deadline_hung"];
      mocks.runQuery.mockRejectedValue(failedQuery("Unrecognized name: planx"));
      mocks.fetch.mockImplementation(
        (url: string, init?: { signal?: AbortSignal }) =>
          String(url).endsWith(`/tables/${fast}`)
            ? Promise.resolve(
                jsonResponse(tableMetadata(fast, [["plan", "STRING"]])),
              )
            : hangUntilAborted(init),
      );
      let settled = false;
      const run = bigquery
        .run({
          sql: `SELECT planx FROM product.${fast} a JOIN product.${hung} b ON a.id = b.id`,
        })
        .finally(() => {
          settled = true;
        });

      await vi.advanceTimersByTimeAsync(8_000);

      expect(settled).toBe(true);
      const result = (await run) as Record<string, unknown>;
      expect(result).toMatchObject({
        error: "bigquery_query_failed",
        table: `test-project.product.${fast}`,
        didYouMean: ["plan"],
        unreadTables: [`test-project.product.${hung}`],
      });
      expect(result).not.toHaveProperty("schemaLookup");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("says the lookup failed when the only table read hangs", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      mocks.runQuery.mockRejectedValue(
        failedQuery("Unrecognized name: event_time"),
      );
      mocks.fetch.mockImplementation((_url: string, init) =>
        hangUntilAborted(init),
      );
      const run = bigquery.run({
        sql: "SELECT event_time FROM `test-project.product.signups_deadline_only`",
      });

      await vi.advanceTimersByTimeAsync(8_000);

      expect(await run).toMatchObject({
        error: "bigquery_query_failed",
        schemaLookup: "failed",
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("clears the deadline timer once the lookup answers", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      // Not freshTable(): a shifted sequence reorders the string-sorted URLs of
      // the comma-join test below.
      const table = "signups_deadline_timer";
      mocks.runQuery.mockRejectedValue(
        failedQuery("Unrecognized name: event_time"),
      );
      mocks.fetch.mockResolvedValue(
        jsonResponse(tableMetadata(table, [["event_timestamp", "TIMESTAMP"]])),
      );

      const result = (await bigquery.run({
        sql: `SELECT event_time FROM \`test-project.product.${table}\``,
      })) as Record<string, unknown>;

      expect(result).toMatchObject({ didYouMean: ["event_timestamp"] });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("tables read out of the SQL", () => {
    const answerOnly = (known: Record<string, Array<[string, string]>>) =>
      mocks.fetch.mockImplementation(async (url: string) => {
        const table = /\/tables\/([^/?]+)$/.exec(String(url))?.[1] ?? "";
        return known[table]
          ? jsonResponse(tableMetadata(table, known[table]))
          : jsonResponse({ error: { message: "Not found" } }, 404);
      });

    it("skips FROM inside EXTRACT, TRIM and IS DISTINCT FROM, comments, and string literals", async () => {
      const table = freshTable();
      mocks.runQuery.mockRejectedValue(failedQuery("Unrecognized name: planx"));
      answerOnly({ [table]: [["plan", "STRING"]] });

      const result = (await bigquery.run({
        sql: `-- from analytics.old_events
SELECT EXTRACT(MONTH FROM o.created_at) AS m,
  TRIM(BOTH ' ' FROM u.name) AS n,
  'copied from sales.legacy_notes' AS note,
  planx
FROM product.${table} o /* join archive.old_orders */
WHERE o.a IS DISTINCT FROM u.b`,
      })) as Record<string, unknown>;

      expect(result).toMatchObject({
        table: `test-project.product.${table}`,
        didYouMean: ["plan"],
      });
      expect(result).not.toHaveProperty("unreadTables");
      expect(metadataFetches()).toHaveLength(1);
    });

    it("reads a project-and-dataset-quoted path and every table of a comma join", async () => {
      const [first, second] = [freshTable(), freshTable()];
      mocks.runQuery.mockRejectedValue(failedQuery("Unrecognized name: planx"));
      answerOnly({
        [first]: [["id", "STRING"]],
        [second]: [["plan", "STRING"]],
      });

      const result = (await bigquery.run({
        sql: `SELECT planx FROM \`test-project.product\`.${first} a, product.${second} b`,
      })) as Record<string, unknown>;

      expect(metadataFetches().map(([url]) => String(url))).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            `/projects/test-project/datasets/product/tables/${first}`,
          ),
          expect.stringContaining(
            `/projects/test-project/datasets/product/tables/${second}`,
          ),
        ]),
      );
      expect(result).toMatchObject({
        table: `test-project.product.${second}`,
        didYouMean: ["plan"],
      });
    });

    it("does not read the array column of an earlier table as a table", async () => {
      const table = freshTable();
      mocks.runQuery.mockRejectedValue(failedQuery("Unrecognized name: planx"));
      answerOnly({ [table]: [["plan", "STRING"]] });

      const result = (await bigquery.run({
        sql: `SELECT planx FROM product.${table} o, o.items i, UNNEST(o.tags) t`,
      })) as Record<string, unknown>;

      expect(result).not.toHaveProperty("unreadTables");
      expect(metadataFetches()).toHaveLength(1);
    });
  });

  describe("a missing table", () => {
    const missing = failedQuery(
      "Not found: Table test-project:product.signup_events was not found in location US",
    );
    const listing = (count: number, name = (i: number) => `signups_${i}`) =>
      jsonResponse({
        tables: Array.from({ length: count }, (_, i) => ({
          tableReference: { datasetId: "product", tableId: name(i) },
        })),
      });

    it("marks a suggestion list drawn from a dataset with more tables than were listed", async () => {
      mocks.runQuery.mockRejectedValue(missing);
      mocks.fetch.mockResolvedValue(listing(201));

      const result = (await bigquery.run({
        sql: "SELECT * FROM `test-project.product.signup_events`",
      })) as Record<string, unknown>;

      expect(String(mocks.fetch.mock.calls[0]![0])).toContain("maxResults=201");
      expect(result).toMatchObject({ truncated: true });
    });

    it("does not mark a dataset that was listed in full", async () => {
      mocks.runQuery.mockRejectedValue(missing);
      mocks.fetch.mockResolvedValue(listing(200));

      const result = (await bigquery.run({
        sql: "SELECT * FROM `test-project.product.signup_events`",
      })) as Record<string, unknown>;

      expect(result).not.toHaveProperty("truncated");
    });

    it("does not claim the schema is below when no table is near the name", async () => {
      mocks.runQuery.mockRejectedValue(missing);
      mocks.fetch.mockResolvedValue(listing(1, () => "q".repeat(30)));

      const result = (await bigquery.run({
        sql: "SELECT * FROM `test-project.product.signup_events`",
      })) as Record<string, unknown>;

      expect(result).toMatchObject({ didYouMeanTables: [] });
      expect(String(result.hint)).not.toContain("is below");
      expect(String(result.hint)).toContain("search-bigquery-schema");
    });
  });
});
