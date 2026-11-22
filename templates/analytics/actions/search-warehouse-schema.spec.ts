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

  it("reports a dataset it could not list instead of leaving it out silently", async () => {
    delete lists.finance;
    const result = await search({});
    expect(result.complete).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ datasetId: "finance" }),
    ]);
  });
});
