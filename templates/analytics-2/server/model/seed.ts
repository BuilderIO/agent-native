import { and, eq } from "@agent-native/core/db/schema";

import type {
  Cell,
  CellDraft,
  CellOutput,
} from "../../app/lib/model/contracts.js";
import {
  aggregateSampleTable,
  formatMetricValue,
  sampleTable,
  withMonthColumn,
} from "../../app/lib/model/sample-data.js";
import type { SampleTable } from "../../app/lib/model/sample-data.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { getDb, schema } from "../db/index.js";
import {
  addProjectToCollection,
  createCollection,
} from "./collections-store.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { createProject } from "./projects-store.js";
import { recordRun, type CellOutputRecord } from "./runs-store.js";
import { sampleQuery } from "./sample-query.js";
import { type WorkspaceScope, requireWorkspaceScope } from "./scope.js";

const { projects } = schema;

/**
 * The workspace a brand-new account opens with.
 *
 * Everything below is derived from the fixed sample data, including the cell
 * ids and the timestamps, so the same three projects appear in the same order
 * with the same numbers on every machine.
 */
const SEED_BASE_ISO = "2026-01-01T09:00:00.000Z";

const sampleQueries = {
  revenue: {
    sql: "select order_date, order_total, channel from orders order by order_date limit 1000",
    minutes: 1,
  },
  segments: {
    sql: "select customer_name, country, segment from customers limit 1000",
    minutes: 6,
  },
  funnel: {
    sql: "select session_date, stage, users, conversions from sessions limit 1000",
    minutes: 11,
  },
};
type SampleProject = keyof typeof sampleQueries;

function at(minutes: number): string {
  return new Date(Date.parse(SEED_BASE_ISO) + minutes * 60_000).toISOString();
}

/**
 * Sample records are namespaced per account: the content is identical for
 * everyone, but the ids stay unique so two accounts can hold the same sample
 * projects in one database.
 */
export function sampleWorkspaceKey(scopeInput: WorkspaceScope): string {
  const scope = requireWorkspaceScope(scopeInput);
  let hash = 0x811c9dc5;
  for (const character of `${scope.orgId}:${scope.ownerEmail}`.toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(0, 7);
}

export function sampleProjectId(scope: WorkspaceScope, slug: string): string {
  return `prj_sample_${sampleWorkspaceKey(scope)}_${slug}`;
}

export function sampleCellId(
  scope: WorkspaceScope,
  slug: string,
  cell: string,
): string {
  return `cel_sample_${sampleWorkspaceKey(scope)}_${slug}_${cell}`;
}

export function sampleCollectionId(scope: WorkspaceScope): string {
  return `col_sample_${sampleWorkspaceKey(scope)}_starting_point`;
}

function tableOutput(slug: SampleProject, columns?: string[]): CellOutput {
  const result = sampleQuery(sampleQueries[slug].sql);
  if (!result) throw new Error("Could not execute the sample project query.");
  if (!columns) return result.output;
  const indices = columns.map((name) =>
    result.output.columns.findIndex((column) => column.name === name),
  );
  return {
    ...result.output,
    columns: result.output.columns.filter((column) =>
      columns.includes(column.name),
    ),
    rows: result.output.rows.map((row) =>
      indices.map((index) => row[index] ?? null),
    ),
  };
}

function sampleSlug(scope: WorkspaceScope, projectId: string) {
  return (["revenue", "segments", "funnel"] as const).find(
    (slug) => projectId === sampleProjectId(scope, slug),
  );
}

export function seededSqlSource(
  scope: WorkspaceScope,
  cell: Pick<Cell, "id" | "projectId" | "contents">,
) {
  const contents = cell.contents;
  if (
    contents.kind !== "sql" ||
    contents.dataConnectionId !== null ||
    contents.connectionMode === "dataframes"
  )
    return undefined;
  const slug = sampleSlug(scope, cell.projectId);
  if (
    slug &&
    cell.id === sampleCellId(scope, slug, "sql") &&
    contents.source === sampleQueries[slug].sql
  )
    return SAMPLE_DATA_SOURCE_ID;
  return undefined;
}

let cachedSampleCharts: {
  revenueByMonth: SampleTable;
  revenueByChannel: SampleTable;
  customersBySegment: SampleTable;
  usersByStage: SampleTable;
} | null = null;

function sampleChartTables() {
  if (cachedSampleCharts) return cachedSampleCharts;
  const orders = sampleTable("orders");
  const customers = sampleTable("customers");
  const sessions = sampleTable("sessions");
  if (orders === null || customers === null || sessions === null) {
    throw new Error("The sample tables are unavailable.");
  }
  cachedSampleCharts = {
    revenueByMonth: aggregateSampleTable(
      withMonthColumn(orders, "order_date"),
      {
        groupBy: "order_date_month",
        measure: "order_total",
        aggregation: "sum",
      },
    ),
    revenueByChannel: aggregateSampleTable(orders, {
      groupBy: "channel",
      measure: "order_total",
      aggregation: "sum",
    }),
    customersBySegment: aggregateSampleTable(customers, {
      groupBy: "segment",
      aggregation: "count",
    }),
    usersByStage: aggregateSampleTable(sessions, {
      groupBy: "stage",
      measure: "users",
      aggregation: "sum",
    }),
  };
  return cachedSampleCharts;
}

function sampleChartDataframe(grouped: SampleTable): string {
  const [category, measure] = grouped.columns;
  if (category == null || measure == null || grouped.columns.length !== 2) {
    throw new Error("Sample chart data must have exactly two columns.");
  }
  const records = grouped.rows.map((row) => {
    const label = row[0];
    const value = row[1];
    if (
      typeof label !== "string" ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      throw new Error(
        "Sample chart data must contain string and numeric values.",
      );
    }
    return { [category.name]: label, [measure.name]: value };
  });
  return JSON.stringify(records);
}

function seededChartDataframe(
  scope: WorkspaceScope,
  cell: Cell,
): string | undefined {
  const contents = cell.contents;
  if (contents.kind !== "chart" || contents.chartSpec.sourceCellId != null) {
    return undefined;
  }
  const slug = sampleSlug(scope, cell.projectId);
  if (!slug) return undefined;
  const charts = sampleChartTables();
  if (
    slug === "revenue" &&
    cell.id === sampleCellId(scope, slug, "chart") &&
    contents.dataframe === "revenue_by_month"
  ) {
    return sampleChartDataframe(charts.revenueByMonth);
  }
  if (
    slug === "revenue" &&
    cell.id === sampleCellId(scope, slug, "channel") &&
    contents.dataframe === "revenue_by_channel"
  ) {
    return sampleChartDataframe(charts.revenueByChannel);
  }
  if (
    slug === "segments" &&
    cell.id === sampleCellId(scope, slug, "chart") &&
    contents.dataframe === "customers_by_segment"
  ) {
    return sampleChartDataframe(charts.customersBySegment);
  }
  if (
    slug === "funnel" &&
    cell.id === sampleCellId(scope, slug, "chart") &&
    contents.dataframe === "users_by_stage"
  ) {
    return sampleChartDataframe(charts.usersByStage);
  }
  return undefined;
}

export function readSeededSampleCell(
  scope: WorkspaceScope,
  cell: Cell,
  output: CellOutputRecord | undefined,
) {
  const contents = cell.contents;
  const source = seededSqlSource(scope, cell);
  const chartDataframe = seededChartDataframe(scope, cell);
  const slug = sampleSlug(scope, cell.projectId);
  if (
    slug &&
    output?.ranAt === at(sampleQueries[slug].minutes) &&
    output.sourceConnectionId === null
  ) {
    if (contents.kind === "sql" && cell.id === sampleCellId(scope, slug, "sql"))
      output = { ...output, output: tableOutput(slug) };
    if (
      contents.kind === "display-table" &&
      cell.id === sampleCellId(scope, slug, "table")
    )
      output = {
        ...output,
        output: tableOutput(
          slug,
          contents.columns.map((column) => column.name),
        ),
      };
  }
  return {
    cell:
      contents.kind === "sql" && source
        ? { ...cell, contents: { ...contents, dataConnectionId: source } }
        : contents.kind === "chart" && chartDataframe
          ? { ...cell, contents: { ...contents, dataframe: chartDataframe } }
          : cell,
    output,
  };
}

function chartOutput(grouped: SampleTable): CellOutput {
  return {
    type: "chart",
    columns: grouped.columns.map((column) => column.name),
    rows: grouped.rows.map((row) =>
      row.map((value) => (typeof value === "boolean" ? String(value) : value)),
    ),
  };
}

function metricOutput(
  value: number,
  format: "currency" | "number",
): CellOutput {
  return {
    type: "metric",
    value,
    formatted: formatMetricValue(value, format),
  };
}

function markdownCell(id: string, order: string, markdown: string): CellDraft {
  return {
    id,
    order,
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "markdown",
    markdown,
  };
}

function sqlCell(
  id: string,
  order: string,
  source: string,
  resultVariable: string,
): CellDraft {
  return {
    id,
    order,
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "sql",
    source,
    dataConnectionId: SAMPLE_DATA_SOURCE_ID,
    databaseSchema: null,
    resultVariable,
    outputResult: true,
  };
}

function tableCell(
  id: string,
  order: string,
  dataframe: string,
  columns: string[],
): CellDraft {
  return {
    id,
    order,
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "display-table",
    dataframe,
    columns: columns.map((name) => ({
      name,
      header: null,
      format: null,
      hidden: false,
    })),
  };
}

function chartCell(
  id: string,
  order: string,
  grouped: SampleTable,
  spec: {
    mark: "line" | "bar" | "area" | "scatter" | "pie";
    title: string;
  },
): CellDraft {
  const dataframe = sampleChartDataframe(grouped);
  const [category, measure] = grouped.columns;
  if (category == null || measure == null) {
    throw new Error("Sample chart data must have exactly two columns.");
  }
  return {
    id,
    order,
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "chart",
    dataframe,
    chartSpec: {
      mark: spec.mark,
      xField: category.name,
      yField: measure.name,
      seriesField: null,
      title: spec.title,
    },
  };
}

function metricCell(
  id: string,
  order: string,
  valueVariableName: string,
  title: string,
  format: "currency" | "number",
): CellDraft {
  return {
    id,
    order,
    label: title,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "metric",
    valueVariableName,
    valueRowIndex: null,
    resultVariable: null,
    outputResult: true,
    format,
  };
}

export type SampleWorkspace = { projectIds: string[]; created: boolean };

/** True when the account already has content, so seeding is a no-op. */
export async function hasWorkspaceContent(
  scopeInput: WorkspaceScope,
): Promise<boolean> {
  const scope = requireWorkspaceScope(scopeInput);
  const rows = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.ownerEmail, scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Creates the starting projects, their cells and their outputs for an account
 * that has none. Running it twice changes nothing.
 */
export async function ensureSampleWorkspace(
  scopeInput: WorkspaceScope,
): Promise<SampleWorkspace> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  if (await hasWorkspaceContent(scope)) {
    return { projectIds: [], created: false };
  }

  const orders = sampleTable("orders");
  const customers = sampleTable("customers");
  const sessions = sampleTable("sessions");
  if (orders === null || customers === null || sessions === null) {
    throw new Error("The sample tables are unavailable.");
  }

  const { revenueByMonth, revenueByChannel, customersBySegment, usersByStage } =
    sampleChartTables();

  const revenueTotal = orders.rows.reduce((total, row) => {
    const value = row[6];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
  const customerCount = customers.rows.length;
  const visitorCount = sessions.rows.reduce((total, row) => {
    const value = row[2];
    return typeof value === "number" && row[1] === "visit"
      ? total + value
      : total;
  }, 0);

  const revenue = await createProject({
    ...scope,
    projectId: sampleProjectId(scope, "revenue"),
    title: "Revenue overview",
    description: "Monthly revenue, order volume and the best selling channels.",
    cells: [
      markdownCell(
        sampleCellId(scope, "revenue", "intro"),
        "a",
        "# Revenue overview\n\nHow the business is trending this quarter.",
      ),
      sqlCell(
        sampleCellId(scope, "revenue", "sql"),
        "b",
        sampleQueries.revenue.sql,
        "orders",
      ),
      tableCell(sampleCellId(scope, "revenue", "table"), "c", "orders", [
        "order_date",
        "order_total",
        "channel",
      ]),
      chartCell(sampleCellId(scope, "revenue", "chart"), "d", revenueByMonth, {
        mark: "bar",
        title: "Revenue by month",
      }),
      metricCell(
        sampleCellId(scope, "revenue", "metric"),
        "e",
        "revenue_total",
        "Revenue",
        "currency",
      ),
      chartCell(
        sampleCellId(scope, "revenue", "channel"),
        "f",
        revenueByChannel,
        {
          mark: "bar",
          title: "Revenue by channel",
        },
      ),
    ],
    at: at(0),
  });

  const segments = await createProject({
    ...scope,
    projectId: sampleProjectId(scope, "segments"),
    title: "Customer segments",
    description: "Who our customers are and how each segment is growing.",
    cells: [
      markdownCell(
        sampleCellId(scope, "segments", "intro"),
        "a",
        "## Customer segments\n\nEvery account, by country and segment.",
      ),
      sqlCell(
        sampleCellId(scope, "segments", "sql"),
        "b",
        sampleQueries.segments.sql,
        "customers",
      ),
      tableCell(sampleCellId(scope, "segments", "table"), "c", "customers", [
        "customer_name",
        "country",
        "segment",
      ]),
      chartCell(
        sampleCellId(scope, "segments", "chart"),
        "d",
        customersBySegment,
        {
          mark: "bar",
          title: "Customers by segment",
        },
      ),
      metricCell(
        sampleCellId(scope, "segments", "metric"),
        "e",
        "customer_count",
        "Customers",
        "number",
      ),
    ],
    at: at(5),
  });

  const funnel = await createProject({
    ...scope,
    projectId: sampleProjectId(scope, "funnel"),
    title: "Signup funnel",
    description: "How visitors move through signup, activation and purchase.",
    cells: [
      markdownCell(
        sampleCellId(scope, "funnel", "intro"),
        "a",
        "## Signup funnel\n\nVisitors by stage over the last 30 days.",
      ),
      sqlCell(
        sampleCellId(scope, "funnel", "sql"),
        "b",
        sampleQueries.funnel.sql,
        "sessions",
      ),
      tableCell(sampleCellId(scope, "funnel", "table"), "c", "sessions", [
        "session_date",
        "stage",
        "users",
      ]),
      chartCell(sampleCellId(scope, "funnel", "chart"), "d", usersByStage, {
        mark: "bar",
        title: "Users by stage",
      }),
      metricCell(
        sampleCellId(scope, "funnel", "metric"),
        "e",
        "visitor_count",
        "Visitors",
        "number",
      ),
    ],
    at: at(10),
  });

  const collection = await createCollection({
    ...scope,
    collectionId: sampleCollectionId(scope),
    name: "Starting point",
    description: "Example projects built on the sample data.",
    at: at(0),
  });
  for (const project of [revenue, segments, funnel]) {
    await addProjectToCollection({
      ...scope,
      projectId: project.id,
      collectionId: collection.id,
      at: at(0),
    });
  }

  const outputs: {
    projectId: string;
    cellId: string;
    output: CellOutput;
    minutes: number;
  }[] = [
    {
      projectId: revenue.id,
      cellId: sampleCellId(scope, "revenue", "sql"),
      output: tableOutput("revenue"),
      minutes: 1,
    },
    {
      projectId: revenue.id,
      cellId: sampleCellId(scope, "revenue", "table"),
      output: tableOutput("revenue"),
      minutes: 1,
    },
    {
      projectId: revenue.id,
      cellId: sampleCellId(scope, "revenue", "chart"),
      output: chartOutput(revenueByMonth),
      minutes: 1,
    },
    {
      projectId: revenue.id,
      cellId: sampleCellId(scope, "revenue", "metric"),
      output: metricOutput(revenueTotal, "currency"),
      minutes: 1,
    },
    {
      projectId: revenue.id,
      cellId: sampleCellId(scope, "revenue", "channel"),
      output: chartOutput(revenueByChannel),
      minutes: 1,
    },
    {
      projectId: segments.id,
      cellId: sampleCellId(scope, "segments", "sql"),
      output: tableOutput("segments"),
      minutes: 6,
    },
    {
      projectId: segments.id,
      cellId: sampleCellId(scope, "segments", "table"),
      output: tableOutput("segments"),
      minutes: 6,
    },
    {
      projectId: segments.id,
      cellId: sampleCellId(scope, "segments", "chart"),
      output: chartOutput(customersBySegment),
      minutes: 6,
    },
    {
      projectId: segments.id,
      cellId: sampleCellId(scope, "segments", "metric"),
      output: metricOutput(customerCount, "number"),
      minutes: 6,
    },
    {
      projectId: funnel.id,
      cellId: sampleCellId(scope, "funnel", "sql"),
      output: tableOutput("funnel"),
      minutes: 11,
    },
    {
      projectId: funnel.id,
      cellId: sampleCellId(scope, "funnel", "table"),
      output: tableOutput("funnel", ["session_date", "stage", "users"]),
      minutes: 11,
    },
    {
      projectId: funnel.id,
      cellId: sampleCellId(scope, "funnel", "chart"),
      output: chartOutput(usersByStage),
      minutes: 11,
    },
    {
      projectId: funnel.id,
      cellId: sampleCellId(scope, "funnel", "metric"),
      output: metricOutput(visitorCount, "number"),
      minutes: 11,
    },
  ];

  for (const entry of outputs) {
    await recordRun({
      ...scope,
      projectId: entry.projectId,
      cellId: entry.cellId,
      status: "complete",
      output: entry.output,
      startedAt: at(entry.minutes),
      finishedAt: at(entry.minutes),
      durationMs: 118,
    });
  }

  return {
    projectIds: [revenue.id, segments.id, funnel.id],
    created: true,
  };
}
