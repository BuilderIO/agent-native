import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({ projectId: "builder-3b0a2" }));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: <T>(definition: T) => definition,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getCredentialContext: () => ({
    userEmail: "alice@example.com",
    orgId: "org-1",
  }),
}));
vi.mock("../server/lib/credentials", () => ({
  resolveCredential: async (key: string) =>
    key === "BIGQUERY_PROJECT_ID" ? connection.projectId : null,
}));
vi.mock("../server/lib/gcloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/gcloud")>()),
  getBigQueryAccessToken: async () => "test-token",
}));

const { default: action } = await import("./search-warehouse-schema.js");
const { BIGQUERY_AGENT_DATASET_ALLOWLIST } =
  await import("../server/lib/bigquery-agent-sql-policy.js");

const PROJECT = "builder-3b0a2";
const ALLOWED = BIGQUERY_AGENT_DATASET_ALLOWLIST[PROJECT] ?? [];

type TableList = {
  tables: Array<{ tableId: string; type?: string }>;
  nextPageToken?: string;
};

let lists: Partial<Record<string, TableList>>;
let metadata: Partial<Record<string, Record<string, unknown>>>;
const requested: string[] = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function table(
  datasetId: string,
  tableId: string,
  columns: Array<{ name: string; type?: string; description?: string }>,
  extra: Record<string, unknown> = {},
) {
  metadata[`${datasetId}.${tableId}`] = {
    tableReference: { projectId: PROJECT, datasetId, tableId },
    type: "TABLE",
    location: "US",
    schema: {
      fields: columns.map((column) => ({ type: "STRING", ...column })),
    },
    ...extra,
  };
}

interface SearchResult {
  mode: string;
  table: Record<string, unknown>;
  tables: Array<Record<string, unknown>>;
  matched: number;
  truncated: boolean;
  complete: boolean;
  incompleteReasons: string[];
  errors: Array<Record<string, unknown>>;
  columnSearch?: { tablesRead: number; tablesListed: number };
}

async function search(args: Record<string, unknown>) {
  return (await action.run(
    action.schema.parse(args),
  )) as unknown as SearchResult;
}

async function thrown(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    return error as Error & { errorCode?: string; statusCode?: number };
  }
  throw new Error("Expected the call to fail");
}

let suffix = 0;

beforeEach(() => {
  suffix++;
  connection.projectId = PROJECT;
  requested.length = 0;
  lists = Object.fromEntries(
    ALLOWED.map((dataset) => [dataset, { tables: [] }]),
  );
  metadata = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(url.pathname);
      const match = url.pathname.match(
        /\/projects\/([^/]+)\/datasets\/([^/]+)\/tables(?:\/([^/]+))?$/,
      );
      if (!match) throw new Error(`Unexpected request ${url}`);
      const [, , datasetId, tableId] = match as unknown as [
        string,
        string,
        string,
        string | undefined,
      ];
      if (tableId) {
        const meta = metadata[`${datasetId}.${decodeURIComponent(tableId)}`];
        return meta
          ? json(meta)
          : json({ error: { code: 404, message: "Not found" } }, 404);
      }
      const list = lists[datasetId];
      if (!list) return json({ error: { code: 403, message: "denied" } }, 403);
      return json({
        tables: list.tables.map((entry) => ({
          tableReference: {
            projectId: PROJECT,
            datasetId,
            tableId: entry.tableId,
          },
          type: entry.type ?? "TABLE",
        })),
        ...(list.nextPageToken ? { nextPageToken: list.nextPageToken } : {}),
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("search-warehouse-schema", () => {
  it("searches only the approved datasets, never cloud billing data", async () => {
    const pageviews = `blog_pageviews_${suffix}`;
    lists.dbt_mart = { tables: [{ tableId: pageviews }] };
    table("dbt_mart", pageviews, [{ name: "url" }, { name: "pageviews" }]);
    const result = await search({ search: "pageviews" });
    expect(result.tables).toEqual([
      expect.objectContaining({
        projectId: PROJECT,
        datasetId: "dbt_mart",
        tableId: pageviews,
        queryable: true,
      }),
    ]);
    const listed = requested
      .filter((path) => path.endsWith("/tables"))
      .map((path) => path.split("/")[6]);
    expect(new Set(listed)).toEqual(new Set(ALLOWED));
    expect(requested.some((path) => path.includes("billing_export"))).toBe(
      false,
    );
    expect(result.complete).toBe(true);
  });

  it("finds a table by one of its columns", async () => {
    const signups = `fct_signups_${suffix}`;
    lists.dbt_analytics = { tables: [{ tableId: signups }] };
    table("dbt_analytics", signups, [
      { name: "signup_week", type: "DATE", description: "Week of signup" },
    ]);
    const result = await search({ search: "signup_week" });
    expect(result.tables).toEqual([
      expect.objectContaining({
        tableId: signups,
        matchedColumns: ["signup_week"],
      }),
    ]);
  });

  it("describes one approved table's columns and says whether query-warehouse can read it", async () => {
    const users = `users_${suffix}`;
    table("dbt_mart", users, [
      { name: "id", type: "INT64" },
      { name: "created_at", type: "TIMESTAMP", description: "Signup time" },
    ]);
    const result = await search({ table: `dbt_mart.${users}` });
    expect(result).toMatchObject({
      mode: "table",
      table: {
        projectId: PROJECT,
        datasetId: "dbt_mart",
        tableId: users,
        queryable: true,
        columns: [
          { name: "id", type: "INT64" },
          { name: "created_at", type: "TIMESTAMP", description: "Signup time" },
        ],
        columnsTruncated: false,
      },
    });
  });

  it("marks a view query-warehouse would refuse as not queryable", async () => {
    const view = `v_users_${suffix}`;
    table("dbt_mart", view, [{ name: "id" }], { type: "VIEW" });
    const result = await search({ table: `${PROJECT}.dbt_mart.${view}` });
    expect(result.table).toMatchObject({
      type: "VIEW",
      queryable: false,
      notQueryableReason: expect.stringMatching(/view/),
    });
  });

  it.each([
    ["a dataset off the list", "raw_pii.people"],
    ["cloud billing data", "billing_export.gcp_billing_export_v1_0123"],
    ["another project", "other-project.dbt_mart.users"],
  ])("refuses to describe %s without asking BigQuery", async (_name, ref) => {
    const error = await thrown(() => search({ table: ref }));
    expect(error).toMatchObject({
      errorCode: "query_table_not_allowed",
      statusCode: 403,
    });
    expect(requested).toEqual([]);
  });

  it("refuses a dataset filter off the list at the schema", () => {
    expect(() => action.schema.parse({ dataset: "billing_export" })).toThrow();
  });

  it("refuses everything on a connection whose project has no approved datasets", async () => {
    connection.projectId = "someone-elses-project";
    const error = await thrown(() => search({ search: "users" }));
    expect(error).toMatchObject({ errorCode: "query_table_not_allowed" });
    expect(requested).toEqual([]);
  });

  it("says it is incomplete when a dataset has more tables than one page", async () => {
    lists.amplitude = {
      tables: [{ tableId: `events_${suffix}` }],
      nextPageToken: "more",
    };
    const result = await search({ dataset: "amplitude" });
    expect(result.complete).toBe(false);
    expect(result.incompleteReasons.join(" ")).toMatch(/amplitude/);
  });

  it("reads at most 40 tables' columns in one call and says how many it read", async () => {
    lists.dbt_staging_bigquery = {
      tables: Array.from({ length: 60 }, (_, index) => ({
        tableId: `stg_${suffix}_${index}`,
      })),
    };
    for (let index = 0; index < 60; index++) {
      table("dbt_staging_bigquery", `stg_${suffix}_${index}`, [{ name: "id" }]);
    }
    const result = await search({
      dataset: "dbt_staging_bigquery",
      search: "nothing_matches_this",
    });
    expect(
      requested.filter((path) => /\/tables\/[^/]+$/.test(path)),
    ).toHaveLength(40);
    expect(result.columnSearch).toEqual({ tablesRead: 40, tablesListed: 60 });
    expect(result.complete).toBe(false);
  });

  it("shares one 40-table metadata allowance between the column search and the tables it returns", async () => {
    lists.dbt_staging_bigquery = {
      tables: Array.from({ length: 60 }, (_, index) => ({
        tableId: `signups_${suffix}_${index}`,
      })),
    };
    for (let index = 0; index < 60; index++) {
      table("dbt_staging_bigquery", `signups_${suffix}_${index}`, [
        { name: "id" },
      ]);
    }
    const result = await search({
      dataset: "dbt_staging_bigquery",
      search: "signups",
      limit: 50,
    });
    expect(
      requested.filter((path) => /\/tables\/[^/]+$/.test(path)),
    ).toHaveLength(40);
    expect(result.tables).toHaveLength(50);
    expect(result.matched).toBe(60);
    expect(
      result.tables.filter((entry) => entry.queryable === true),
    ).toHaveLength(40);
    const unchecked = result.tables.filter((entry) => entry.queryable === null);
    expect(unchecked).toHaveLength(10);
    expect(unchecked[0]?.notQueryableReason).toMatch(/Not checked/);
    expect(result.complete).toBe(false);
    expect(result.incompleteReasons).toContainEqual(
      expect.stringMatching(/^10 returned tables were not checked/),
    );
  });

  it("returns at most limit tables and says more matched", async () => {
    lists.metrics = {
      tables: Array.from({ length: 5 }, (_, index) => ({
        tableId: `daily_metric_${suffix}_${index}`,
      })),
    };
    const result = await search({ dataset: "metrics", limit: 2 });
    expect(result.tables).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.matched).toBe(5);
  });

  it("marks a managed BigLake table typed TABLE as not queryable, from its whole tables.get resource", async () => {
    const lake = `lake_users_${suffix}`;
    table("dbt_mart", lake, [{ name: "id" }], {
      biglakeConfiguration: {
        connectionId: "builder-3b0a2.us.lake",
        storageUri: "gs://lake/users",
        fileFormat: "PARQUET",
        tableFormat: "ICEBERG",
      },
    });
    const result = await search({ table: `dbt_mart.${lake}` });
    expect(result.table).toMatchObject({
      type: "TABLE",
      queryable: false,
      notQueryableReason: expect.stringMatching(/BigLake/),
    });
  });

  it.each([
    [
      "a snapshot",
      {
        type: "SNAPSHOT",
        snapshotDefinition: { snapshotTime: "2026-11-01T00:00:00Z" },
      },
    ],
    [
      "a clone",
      { type: "TABLE", cloneDefinition: { cloneTime: "2026-11-01T00:00:00Z" } },
    ],
  ])("marks %s as queryable", async (_name, extra) => {
    const copy = `users_copy_${suffix}`;
    table("dbt_mart", copy, [{ name: "id" }], extra);
    const result = await search({ table: `dbt_mart.${copy}` });
    expect(result.table).toMatchObject({ queryable: true });
  });

  it("classifies every listed table it returns from that table's own resource", async () => {
    const plain = `a_plain_${suffix}`;
    const lake = `b_lake_${suffix}`;
    const unread = `c_unread_${suffix}`;
    lists.finance = {
      tables: [{ tableId: plain }, { tableId: lake }, { tableId: unread }],
    };
    table("finance", plain, [{ name: "id" }]);
    table("finance", lake, [{ name: "id" }], {
      externalDataConfiguration: { sourceUris: ["gs://x/*"] },
    });
    const result = await search({ dataset: "finance" });
    expect(result.tables).toEqual([
      expect.objectContaining({ tableId: plain, queryable: true }),
      expect.objectContaining({
        tableId: lake,
        type: "TABLE",
        queryable: false,
        notQueryableReason: expect.stringMatching(/external/),
      }),
      expect.objectContaining({
        tableId: unread,
        queryable: null,
        notQueryableReason: expect.stringMatching(/could not be read/),
      }),
    ]);
    expect(result.complete).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ datasetId: "finance", tableId: unread }),
    ]);
  });

  it("counts only the tables whose columns it actually read", async () => {
    lists.hubspot = {
      tables: [
        { tableId: `deals_${suffix}` },
        { tableId: `deals_lines_${suffix}` },
        { tableId: `deals_gone_${suffix}` },
      ],
    };
    table("hubspot", `deals_${suffix}`, [{ name: "amount" }]);
    table("hubspot", `deals_lines_${suffix}`, [{ name: "amount" }]);
    const result = await search({ dataset: "hubspot", search: "deals" });
    expect(result.columnSearch).toEqual({ tablesRead: 2, tablesListed: 3 });
    expect(result.errors).toEqual([
      expect.objectContaining({ tableId: `deals_gone_${suffix}` }),
    ]);
  });

  it("reports a dataset it could not list instead of leaving it out silently", async () => {
    delete lists.finance;
    const result = await search({});
    expect(result.complete).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ datasetId: "finance" }),
    ]);
  });
});
