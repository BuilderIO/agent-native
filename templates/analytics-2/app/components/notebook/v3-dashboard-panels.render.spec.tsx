// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { tableToIPC } from "apache-arrow";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell, ChartSpec } from "@/lib/model/contracts";

import { runLocalChartTransform } from "../../../server/execution/local-visualization-transform";
import {
  notebookResultFields,
  notebookTable,
} from "../../../server/execution/notebook-arrow";
import { digest } from "../../../server/model/notebook-execution/planner";
import { migrateChartSpec } from "../../../shared/chart-visualization-config";
import { appSessionIdSchema } from "../../../shared/notebook-execution";
import {
  completeResultManifestSchema,
  resultFieldSchema,
  type ResultField,
} from "../../../shared/notebook-result-contract";
import {
  notebookTransformSchema,
  type NotebookTransform,
} from "../../../shared/visualization-contracts";
import { AppLayoutSnapshot } from "../published/AppLayoutSnapshot";
import type { ChartDataframe } from "./chart-config";
import { ReadOnlyChart } from "./ReadOnlyChart";
import type { NotebookCellOutputState } from "./types";

const { mockUseActionQuery, mockCallAction } = vi.hoisted(() => ({
  mockUseActionQuery: vi.fn(),
  mockCallAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mockUseActionQuery,
  callAction: mockCallAction,
}));

vi.mock("./VisualizationDrillPanel", () => ({
  VisualizationDrillPanel: () => null,
  useVisualizationSelection: vi.fn(),
}));

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    formatCellValue: (value: unknown) => (value == null ? "" : String(value)),
  };
});

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!("getBBox" in SVGElement.prototype)) {
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value() {
        return { x: 0, y: 0, width: 40, height: 12 };
      },
    });
  }
});

afterEach(() => {
  mockUseActionQuery.mockReset();
  mockCallAction.mockReset();
  vi.restoreAllMocks();
});

type ColumnDef = { name: string; type: string };

type PanelFixture = {
  id: string;
  label: string;
  dataframe: string;
  columns: ColumnDef[];
  rows: (string | number | boolean | null)[][];
  version3: boolean;
  spec: Omit<
    ChartSpec,
    "version" | "revision" | "sourceCellId" | "sourceExportId" | "fieldLabels"
  >;
};

function fieldIdFor(name: string, type: ResultField["type"]): string {
  return digest(["result", name, type]);
}

async function buildTransformResponse(
  projectId: string,
  sourceCellId: string,
  panel: PanelFixture,
): Promise<{
  spec: ChartSpec;
  transform: NotebookTransform;
  dataframe: ChartDataframe;
}> {
  const rawFields = notebookResultFields(panel.columns);
  const vizFields = rawFields.map((field) =>
    resultFieldSchema.parse({
      ...field,
      fieldId: fieldIdFor(field.name, field.type),
    }),
  );
  const idByName = new Map(vizFields.map((f) => [f.name, f.fieldId]));
  const mapField = (name: string | null | undefined) =>
    name == null ? null : (idByName.get(name) ?? name);

  const spec: ChartSpec = panel.version3
    ? {
        ...panel.spec,
        version: 3,
        revision: 1,
        sourceCellId,
        sourceExportId: "result",
        xField: mapField(panel.spec.xField),
        yField: mapField(panel.spec.yField),
        seriesField: mapField(panel.spec.seriesField),
        ...(panel.spec.yFields
          ? {
              yFields: panel.spec.yFields.map(
                (name) => idByName.get(name) ?? name,
              ),
            }
          : {}),
        fieldLabels: Object.fromEntries(
          vizFields.map((f) => [f.fieldId, f.name]),
        ),
      }
    : { ...panel.spec };

  const table = notebookTable(
    { columns: panel.columns, rows: panel.rows },
    rawFields,
  );
  const ipc = tableToIPC(table);
  const manifest = completeResultManifestSchema.parse({
    status: "complete",
    result: {
      resultId: `res-${panel.id}`,
      snapshot: {
        workspaceId: "ws-v3",
        projectId,
        head: { versionId: "ver-v3", revision: "1" },
        eventSeq: "1",
      },
      producer: {
        cellId: sourceCellId,
        exportId: "result",
        namespaceId: "ns-v3",
        runId: "run-v3",
        attemptId: "att-v3",
        outputGeneration: "gen-v3",
      },
      inputRevision: "1",
      dependencyFingerprint: "fp-v3",
      kernelGeneration: null,
      sourceGeneration: null,
    },
    fields: rawFields,
    rowCount: String(panel.rows.length),
  });

  const dataframe: ChartDataframe = {
    name: panel.dataframe,
    cellId: sourceCellId,
    resultId: manifest.result.resultId,
    columns: rawFields.map((f) => ({ name: f.name, type: f.type })),
    rows: panel.rows,
  };

  if (panel.spec.mark === "funnel" && panel.spec.funnelOutcomes) {
    return {
      spec,
      dataframe,
      transform: notebookTransformSchema.parse({
        sources: [],
        result: { status: "unconfigured" },
      }),
    };
  }

  const transformSpec = migrateChartSpec(
    spec,
    { cellId: sourceCellId, exportId: "result" },
    vizFields,
  );
  if (!transformSpec) throw new Error("Invalid chart fixture binding");
  const rawRows = await runLocalChartTransform(
    manifest,
    vizFields,
    async function* () {
      yield ipc;
    },
    transformSpec,
  );
  const marks: Array<{
    x: string | number | boolean | null;
    series: string | number | boolean | null;
    value: number | null;
    selectionId: string;
  }> = [];
  const categories: Array<string | number | boolean | null> = [];
  let idx = 0;
  for (const entry of rawRows) {
    const [kind, x, series, value] = entry as [
      0 | 1,
      string | number | boolean | null,
      string | number | boolean | null,
      number | null,
    ];
    if (kind === 1) {
      categories.push(x);
      continue;
    }
    marks.push({ x, series, value, selectionId: `sel-${panel.id}-${idx++}` });
  }

  const transform = notebookTransformSchema.parse({
    sources: [
      {
        binding: {
          cellId: sourceCellId,
          exportId: "result",
          resultId: manifest.result.resultId,
        },
        name: panel.dataframe,
        fields: vizFields,
      },
    ],
    result: {
      kind: "chart",
      status: marks.length ? "ready" : "empty",
      visualizationResultId: `viz-${panel.id}`,
      source: {
        result: manifest.result,
        fields: vizFields,
        completeness: "complete",
        rowCount: panel.rows.length,
      },
      categories,
      rows: marks,
      capped: false,
    },
  });
  return { spec, transform, dataframe };
}

const CHART_PANELS: PanelFixture[] = [
  {
    id: "p1",
    label: "Signed-In Daily Active Visitors by Template",
    dataframe: "panel_1",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "template", type: "STRING" },
      { name: "visitors", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", "mail", 120],
      ["2026-10-01", "calendar", 80],
      ["2026-10-02", "mail", 145],
      ["2026-10-02", "calendar", 95],
    ],
    spec: {
      mark: "area",
      xField: "date",
      yField: "visitors",
      yFields: ["visitors"],
      stacked: true,
      yFormatter: "number",
      seriesField: "template",
      title: "Signed-In Daily Active Visitors by Template",
    },
  },
  {
    id: "p2",
    label: "Signed-In Weekly Active Visitors by Template",
    dataframe: "panel_2",
    version3: false,
    columns: [
      { name: "date", type: "DATE" },
      { name: "template", type: "STRING" },
      { name: "visitors", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", "mail", 520],
      ["2026-10-08", "mail", 610],
      ["2026-10-08", "calendar", 310],
    ],
    spec: {
      mark: "area",
      xField: "date",
      yField: "visitors",
      yFields: ["visitors"],
      stacked: true,
      yFormatter: "number",
      seriesField: "template",
      title: "Signed-In Weekly Active Visitors by Template",
    },
  },
  {
    id: "p3",
    label: "New People by Channel Over Time",
    dataframe: "panel_3",
    version3: true,
    columns: [
      { name: "date", type: "DATE" },
      { name: "channel", type: "STRING" },
      { name: "new_people", type: "INT64" },
    ],
    rows: [
      ["2026-09-15", "Paid", 220],
      ["2026-09-15", "Organic", 95],
      ["2026-10-15", "Paid", 310],
      ["2026-10-15", "Organic", 140],
    ],
    spec: {
      mark: "bar",
      xField: "date",
      yField: "new_people",
      yFields: ["new_people"],
      stacked: true,
      yFormatter: "number",
      legend: true,
      seriesField: "channel",
      title: "New People by Channel Over Time",
    },
  },
  {
    id: "p4",
    label: "New vs Recurring Signed-In Users Over Time",
    dataframe: "panel_4",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "user_type", type: "STRING" },
      { name: "users", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", "Recurring", 300],
      ["2026-10-01", "New", 150],
      ["2026-10-02", "Recurring", 340],
      ["2026-10-02", "New", 180],
    ],
    spec: {
      mark: "area",
      xField: "date",
      yField: "users",
      yFields: ["users"],
      stacked: true,
      colors: ["#8b5cf6", "#10b981"],
      yFormatter: "number",
      seriesOrder: ["Recurring", "New"],
      seriesField: "user_type",
      title: "New vs Recurring Signed-In Users Over Time",
    },
  },
  {
    id: "p5",
    label: "Week 1 and Week 2 Use Over Time",
    dataframe: "panel_5",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "new_people", type: "INT64" },
      { name: "week1_return", type: "FLOAT64" },
      { name: "week2_return", type: "FLOAT64" },
    ],
    rows: [
      ["2026-10-01", 200, 0.14, 0.05],
      ["2026-10-08", 240, 0.16, 0.07],
    ],
    spec: {
      mark: "line",
      xField: "date",
      yField: "week1_return",
      yFields: ["week1_return", "week2_return"],
      stacked: false,
      colors: ["#10b981", "#8b5cf6"],
      yFormatter: "percent",
      seriesLabels: {
        week1_return: "Used it in week 1",
        week2_return: "Used it in week 2",
      },
      seriesField: null,
      title: "Week 1 and Week 2 Use Over Time",
    },
  },
  {
    id: "p6",
    label: "Week 1 Use Over Time, Paid vs Organic",
    dataframe: "panel_6",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "paid", type: "FLOAT64" },
      { name: "organic", type: "FLOAT64" },
      { name: "paid_people", type: "INT64" },
      { name: "organic_people", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", 0.11, 0.24, 150, 50],
      ["2026-10-08", 0.13, 0.26, 170, 65],
    ],
    spec: {
      mark: "line",
      xField: "date",
      yField: "paid",
      yFields: ["paid", "organic"],
      stacked: false,
      colors: ["#f59e0b", "#3b82f6"],
      yFormatter: "percent",
      seriesLabels: { paid: "Paid", organic: "Organic" },
      seriesField: null,
      title: "Week 1 Use Over Time, Paid vs Organic",
    },
  },
  {
    id: "p8",
    label: "7-14d Signed-In Return by Starting Template",
    dataframe: "panel_8",
    version3: true,
    columns: [
      { name: "template", type: "STRING" },
      { name: "retained_users", type: "INT64" },
      { name: "cohort_users", type: "INT64" },
      { name: "rate", type: "FLOAT64" },
    ],
    rows: [
      ["mail", 45, 200, 0.225],
      ["calendar", 30, 180, 0.167],
    ],
    spec: {
      mark: "bar",
      xField: "template",
      yField: "rate",
      yFields: ["rate"],
      stacked: false,
      yFormatter: "percent",
      seriesField: null,
      title: "7-14d Signed-In Return by Starting Template",
    },
  },
  {
    id: "p16",
    label: "Signup Events, Split Into People",
    dataframe: "panel_16",
    version3: true,
    columns: [
      { name: "date", type: "DATE" },
      { name: "new_people", type: "INT64" },
      { name: "adding_app", type: "INT64" },
      { name: "repeat_signups", type: "INT64" },
    ],
    rows: [
      ["2026-09-10", 80, 20, 10],
      ["2026-10-10", 110, 35, 14],
    ],
    spec: {
      mark: "bar",
      xField: "date",
      yField: "new_people",
      yFields: ["new_people", "adding_app", "repeat_signups"],
      stacked: true,
      yFormatter: "number",
      seriesLabels: {
        adding_app: "Existing users adding an app",
        new_people: "New people",
        repeat_signups: "Repeat signup, same app",
      },
      legend: true,
      seriesField: null,
      title: "Signup Events, Split Into People",
    },
  },
  {
    id: "p17",
    label: "How New People Arrived",
    dataframe: "panel_17",
    version3: true,
    columns: [
      { name: "date", type: "DATE" },
      { name: "arrival", type: "STRING" },
      { name: "new_people", type: "INT64" },
    ],
    rows: [
      ["2026-09-10", "Direct", 50],
      ["2026-10-10", "Referral", 70],
    ],
    spec: {
      mark: "bar",
      xField: "date",
      yField: "new_people",
      yFields: ["new_people"],
      stacked: true,
      yFormatter: "number",
      legend: true,
      seriesField: "arrival",
      title: "How New People Arrived",
    },
  },
  {
    id: "p25",
    label: "Did Use Jump When the Marketing Nurture Arrived?",
    dataframe: "panel_25",
    version3: true,
    columns: [
      { name: "day", type: "STRING" },
      { name: "people", type: "INT64" },
      { name: "got_email", type: "FLOAT64" },
      { name: "no_email", type: "FLOAT64" },
    ],
    rows: [
      ["0", 100, 0.12, 0.08],
      ["1", 100, 0.15, 0.09],
      ["2", 100, 0.14, 0.07],
    ],
    spec: {
      mark: "line",
      xField: "day",
      yField: "got_email",
      yFields: ["got_email", "no_email"],
      stacked: false,
      colors: ["#8b5cf6", "#94a3b8"],
      yFormatter: "percent",
      seriesLabels: {
        "0": "Email",
        "1": "+1",
        "2": "+2",
        no_email: "Same signup day, no email",
        got_email: "Got the email",
      },
      legend: true,
      seriesField: null,
      title: "Did Use Jump When the Marketing Nurture Arrived?",
    },
  },
  {
    id: "p28",
    label: "Nurture Emails Sent by Day",
    dataframe: "panel_28",
    version3: true,
    columns: [
      { name: "date", type: "DATE" },
      { name: "an_welcome", type: "INT64" },
      { name: "code_welcome", type: "INT64" },
      { name: "mkt_nurture", type: "INT64" },
    ],
    rows: [
      ["2026-09-12", 40, 25, 15],
      ["2026-10-12", 55, 30, 22],
    ],
    spec: {
      mark: "bar",
      xField: "date",
      yField: "an_welcome",
      yFields: ["an_welcome", "code_welcome", "mkt_nurture"],
      stacked: true,
      colors: ["#8b5cf6", "#f59e0b", "#94a3b8"],
      yFormatter: "number",
      seriesLabels: {
        an_welcome: "Agent-Native welcome",
        mkt_nurture: "Marketing nurture",
        code_welcome: "Code welcome",
      },
      legend: true,
      seriesField: null,
      title: "Nurture Emails Sent by Day",
    },
  },
  {
    id: "p31",
    label: "Shared-Link Signups by Week",
    dataframe: "panel_31",
    version3: true,
    columns: [
      { name: "week", type: "DATE" },
      { name: "share_type", type: "STRING" },
      { name: "new_people", type: "INT64" },
    ],
    rows: [
      ["2026-09-07", "public", 18],
      ["2026-10-05", "invite", 29],
    ],
    spec: {
      mark: "bar",
      xField: "week",
      yField: "new_people",
      yFields: ["new_people"],
      stacked: true,
      yFormatter: "number",
      legend: true,
      seriesField: "share_type",
      title: "Shared-Link Signups by Week",
    },
  },
  {
    id: "p33",
    label: "Share Funnel",
    dataframe: "panel_33",
    version3: true,
    columns: [
      { name: "step", type: "STRING" },
      { name: "people", type: "INT64" },
    ],
    rows: [
      ["Link created", 500],
      ["Link opened", 320],
      ["Signed up", 90],
    ],
    spec: {
      mark: "bar",
      xField: "step",
      yField: "people",
      yFields: ["people"],
      stacked: false,
      yFormatter: "number",
      seriesField: null,
      title: "Share Funnel",
    },
  },
  {
    id: "p36",
    label: "Agent Chat Errors by Environment",
    dataframe: "panel_36",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "deployment_environment", type: "STRING" },
      { name: "errors", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", "production", 12],
      ["2026-10-01", "beta", 4],
      ["2026-10-02", "production", 9],
    ],
    spec: {
      mark: "line",
      xField: "date",
      yField: "errors",
      yFields: ["errors"],
      stacked: false,
      yFormatter: "number",
      seriesOrder: ["production", "beta"],
      seriesField: "deployment_environment",
      title: "Agent Chat Errors by Environment",
    },
  },
  {
    id: "p37",
    label: "Recurring Signed-In Users by Template",
    dataframe: "panel_37",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "template", type: "STRING" },
      { name: "visitors", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", "mail", 88],
      ["2026-10-02", "mail", 92],
      ["2026-10-02", "docs", 44],
    ],
    spec: {
      mark: "area",
      xField: "date",
      yField: "visitors",
      yFields: ["visitors"],
      stacked: true,
      yFormatter: "number",
      seriesField: "template",
      title: "Recurring Signed-In Users by Template",
    },
  },
  {
    id: "p38",
    label: "Recurring Signed-In Users by Template (Bar)",
    dataframe: "panel_38",
    version3: true,
    columns: [
      { name: "template", type: "STRING" },
      { name: "visitors", type: "INT64" },
    ],
    rows: [
      ["mail", 450],
      ["calendar", 310],
      ["docs", 205],
    ],
    spec: {
      mark: "bar",
      xField: "template",
      yField: "visitors",
      yFields: ["visitors"],
      stacked: false,
      yFormatter: "number",
      seriesField: null,
      title: "Recurring Signed-In Users by Template (Bar)",
    },
  },
  {
    id: "p39",
    label: "Signups by Template",
    dataframe: "panel_39",
    version3: true,
    columns: [
      { name: "template", type: "STRING" },
      { name: "count", type: "INT64" },
    ],
    rows: [
      ["mail", 620],
      ["calendar", 410],
    ],
    spec: {
      mark: "bar",
      xField: "template",
      yField: "count",
      yFields: ["count"],
      stacked: false,
      yFormatter: "number",
      seriesField: null,
      title: "Signups by Template",
    },
  },
  {
    id: "p40",
    label: "Weekly Builders",
    dataframe: "panel_40",
    version3: false,
    columns: [
      { name: "date", type: "DATE" },
      { name: "series", type: "STRING" },
      { name: "installs", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", "CLI", 140],
      ["2026-10-08", "CLI", 175],
    ],
    spec: {
      mark: "line",
      xField: "date",
      yField: "installs",
      yFields: ["installs"],
      stacked: false,
      yFormatter: "number",
      legend: true,
      seriesField: "series",
      title: "Weekly Builders",
    },
  },
  {
    id: "p42",
    label: "Pageviews Over Time",
    dataframe: "panel_42",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "template", type: "STRING" },
      { name: "count", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", "mail", 1800],
      ["2026-10-02", "mail", 2100],
      ["2026-10-02", "docs", 940],
    ],
    spec: {
      mark: "area",
      xField: "date",
      yField: "count",
      yFields: ["count"],
      stacked: true,
      yFormatter: "number",
      seriesField: "template",
      title: "Pageviews Over Time",
    },
  },
  {
    id: "p43",
    label: "Sessions Over Time",
    dataframe: "panel_43",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "count", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", 920],
      ["2026-10-02", 1040],
    ],
    spec: {
      mark: "area",
      xField: "date",
      yField: "count",
      yFields: ["count"],
      stacked: false,
      yFormatter: "number",
      seriesField: null,
      title: "Sessions Over Time",
    },
  },
  {
    id: "p44",
    label: "Sessions by Agent-Native App",
    dataframe: "panel_44",
    version3: true,
    columns: [
      { name: "app", type: "STRING" },
      { name: "count", type: "INT64" },
    ],
    rows: [
      ["mail", 1200],
      ["calendar", 840],
    ],
    spec: {
      mark: "bar",
      xField: "app",
      yField: "count",
      yFields: ["count"],
      stacked: false,
      yFormatter: "number",
      seriesField: null,
      title: "Sessions by Agent-Native App",
    },
  },
  {
    id: "p47",
    label: "Pageviews by Referrer Domain",
    dataframe: "panel_47",
    version3: true,
    columns: [
      { name: "domain", type: "STRING" },
      { name: "pageviews", type: "INT64" },
    ],
    rows: [
      ["google.com", 4200],
      ["github.com", 1900],
    ],
    spec: {
      mark: "bar",
      xField: "domain",
      yField: "pageviews",
      yFields: ["pageviews"],
      stacked: false,
      yFormatter: "number",
      seriesField: null,
      title: "Pageviews by Referrer Domain",
    },
  },
  {
    id: "p49",
    label: "1-7d Signed-In Return by Starting Template",
    dataframe: "panel_49",
    version3: true,
    columns: [
      { name: "template", type: "STRING" },
      { name: "retained_users", type: "INT64" },
      { name: "cohort_users", type: "INT64" },
      { name: "rate", type: "FLOAT64" },
    ],
    rows: [
      ["mail", 64, 200, 0.32],
      ["calendar", 48, 180, 0.267],
    ],
    spec: {
      mark: "bar",
      xField: "template",
      yField: "rate",
      yFields: ["rate"],
      stacked: false,
      yFormatter: "percent",
      seriesField: null,
      title: "1-7d Signed-In Return by Starting Template",
    },
  },
  {
    id: "p52",
    label: "Onboarding Steps: Where People Leave",
    dataframe: "panel_52",
    version3: true,
    columns: [
      { name: "step", type: "STRING" },
      { name: "shown", type: "INT64" },
      { name: "completed", type: "INT64" },
      { name: "skipped", type: "INT64" },
      { name: "left_here", type: "INT64" },
      { name: "optional", type: "BOOLEAN" },
    ],
    rows: [
      ["Welcome", 1000, 820, 40, 120, false],
      ["Connect account", 860, 540, 120, 180, true],
    ],
    spec: {
      mark: "funnel",
      xField: "step",
      yField: "shown",
      yFields: ["shown"],
      stacked: false,
      seriesField: null,
      funnelOutcomes: {
        completedKey: "completed",
        leftKey: "left_here",
        skippedKey: "skipped",
        optionalKey: "optional",
      },
      title: "Onboarding Steps: Where People Leave",
    },
  },
  {
    id: "p56",
    label: "Setup A/B: Connected Rate by Day",
    dataframe: "panel_56",
    version3: false,
    columns: [
      { name: "date", type: "DATE" },
      { name: "variant", type: "STRING" },
      { name: "exposed_users", type: "INT64" },
      { name: "connected_users", type: "INT64" },
      { name: "rate", type: "FLOAT64" },
    ],
    rows: [
      ["2026-10-01", "control", 100, 35, 0.35],
      ["2026-10-01", "treatment", 100, 44, 0.44],
    ],
    spec: {
      mark: "line",
      xField: "date",
      yField: "rate",
      yFields: ["rate"],
      stacked: false,
      colors: ["#64748b", "#10b981"],
      yFormatter: "percent",
      seriesField: "variant",
      title: "Setup A/B: Connected Rate by Day",
    },
  },
  {
    id: "p57",
    label: "Agent-Native Activation Funnel (Draft)",
    dataframe: "panel_57",
    version3: false,
    columns: [
      { name: "stage", type: "STRING" },
      { name: "users", type: "INT64" },
    ],
    rows: [
      ["Visited", 1000],
      ["Signed in", 450],
      ["Activated", 180],
    ],
    spec: {
      mark: "funnel",
      xField: "stage",
      yField: "users",
      yFields: [],
      stacked: false,
      seriesField: null,
      title: "Agent-Native Activation Funnel (Draft)",
    },
  },
  {
    id: "p58",
    label: "Workspace Connect Funnel",
    dataframe: "panel_58",
    version3: true,
    columns: [
      { name: "stage", type: "STRING" },
      { name: "users", type: "INT64" },
    ],
    rows: [
      ["Opened connect", 400],
      ["Authorized", 290],
      ["Connected", 260],
    ],
    spec: {
      mark: "funnel",
      xField: "stage",
      yField: "users",
      yFields: [],
      stacked: false,
      seriesField: null,
      title: "Workspace Connect Funnel",
    },
  },
  {
    id: "p59",
    label: "Connect Failures per Day",
    dataframe: "panel_59",
    version3: true,
    columns: [
      { name: "date", type: "STRING" },
      { name: "reason", type: "STRING" },
      { name: "people", type: "INT64" },
    ],
    rows: [
      ["2026-10-01", "provision_failed", 11],
      ["2026-10-01", "popup_closed_without_status", 19],
      ["2026-10-02", "other", 6],
    ],
    spec: {
      mark: "bar",
      xField: "date",
      yField: "people",
      yFields: ["people"],
      stacked: true,
      colors: ["#ef4444", "#f59e0b", "#94a3b8"],
      yFormatter: "number",
      seriesOrder: ["provision_failed", "popup_closed_without_status", "other"],
      legend: true,
      seriesField: "reason",
      title: "Connect Failures per Day",
    },
  },
];

describe("v3 dashboard 54-panel spec rendering", () => {
  it("renders all 28 chart panels (24 v3 + 4 unversioned) without error or console failures", async () => {
    const projectId = "prj-v3-dashboard";
    const built = await Promise.all(
      CHART_PANELS.map(async (panel) => {
        const sourceCellId = `sql-${panel.id}`;
        const chartCellId = `chart-${panel.id}`;
        const res = await buildTransformResponse(
          projectId,
          sourceCellId,
          panel,
        );
        return { panel, sourceCellId, chartCellId, ...res };
      }),
    );

    const byCellId = new Map(built.map((item) => [item.chartCellId, item]));
    mockUseActionQuery.mockImplementation(
      (action: string, params?: { cellId?: string }) => {
        if (action === "get-notebook-transform" && params?.cellId) {
          const entry = byCellId.get(params.cellId);
          return {
            data: entry?.transform,
            isPending: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
          };
        }
        return {
          data: undefined,
          isPending: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        };
      },
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dataframes = built.map((item) => item.dataframe);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <div>
              {built.map(({ panel, chartCellId, spec, dataframe }) => (
                <section key={chartCellId} data-panel-id={panel.id}>
                  <ReadOnlyChart
                    context={{
                      projectId,
                      cellId: chartCellId,
                      versionId: "ver-v3",
                      scope: {
                        releaseId: "ver-v3",
                        sessionId: appSessionIdSchema.parse(
                          "00000000-0000-4000-8000-000000000001",
                        ),
                      },
                      sourceResultId: dataframe.resultId ?? null,
                    }}
                    dataframe={panel.dataframe}
                    spec={spec}
                    dataframes={dataframes}
                  />
                </section>
              ))}
            </div>
          </AgentNativeI18nProvider>,
        );
      });

      await vi.waitFor(
        () => {
          const rendered = built.map(({ panel }) => {
            const section = container.querySelector<HTMLElement>(
              `section[data-panel-id="${panel.id}"]`,
            );
            const text = section?.textContent ?? "";
            const hasError =
              text.includes("Couldn’t update chart") ||
              text.includes("Invalid funnel outcome counts");
            if (!section || hasError) {
              return { id: panel.id, label: panel.label, ok: false };
            }
            if (panel.spec.mark === "funnel" && panel.spec.funnelOutcomes) {
              return {
                id: panel.id,
                label: panel.label,
                ok: section.querySelectorAll("button").length > 0,
              };
            }
            if (panel.spec.mark === "funnel") {
              return {
                id: panel.id,
                label: panel.label,
                ok:
                  section.querySelectorAll("[data-funnel-stage]").length ===
                  panel.rows.length,
              };
            }
            const svg = section.querySelector("svg");
            return {
              id: panel.id,
              label: panel.label,
              ok: svg !== null && Number(svg.getAttribute("width")) > 0,
            };
          });
          expect(rendered).toEqual(
            built.map(({ panel }) => ({
              id: panel.id,
              label: panel.label,
              ok: true,
            })),
          );
        },
        { timeout: 15_000 },
      );

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("renders all 23 display-table panels and 3 metric panels in AppLayoutSnapshot (54 panels total with the 28 charts)", async () => {
    const projectId = "prj-v3-dashboard";
    const versionId = "ver-v3";
    const now = "2026-11-20T00:00:00.000Z";
    const cells: Cell[] = [];
    const outputs: Record<string, NotebookCellOutputState> = {};

    for (let i = 1; i <= 23; i++) {
      const sqlId = `sql-t-${i}`;
      const tblId = `tbl-${i}`;
      const df = `table_${i}`;
      cells.push({
        id: sqlId,
        projectId,
        versionId,
        createdAt: now,
        updatedAt: now,
        contents: {
          id: sqlId,
          order: `a${String(i).padStart(2, "0")}1`,
          label: `Table Source ${i}`,
          hidden: true,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          kind: "sql",
          source: "SELECT 1",
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable: df,
          outputResult: true,
        },
      });
      cells.push({
        id: tblId,
        projectId,
        versionId,
        createdAt: now,
        updatedAt: now,
        contents: {
          id: tblId,
          order: `b${String(i).padStart(2, "0")}1`,
          label: `Summary Table ${i}`,
          hidden: false,
          gridX: 0,
          gridY: i,
          gridWidth: 12,
          gridHeight: 4,
          kind: "display-table",
          dataframe: df,
          columns: [
            {
              name: "category",
              header: "Category",
              format: null,
              hidden: false,
            },
            {
              name: "people",
              header: "People",
              format: "number",
              hidden: false,
            },
            {
              name: "share",
              header: "Share",
              format: "percent",
              hidden: false,
            },
          ],
        },
      });
      outputs[sqlId] = {
        output: {
          type: "table",
          columns: [
            { name: "category", type: "string" },
            { name: "people", type: "number" },
            { name: "share", type: "number" },
          ],
          rows: [
            ["Direct", 120, 0.4],
            ["Organic", 180, 0.6],
          ],
          rowCount: 2,
          truncated: false,
        },
      };
    }

    for (let i = 1; i <= 3; i++) {
      const sqlId = `sql-m-${i}`;
      const metId = `met-${i}`;
      const df = `metric_${i}`;
      cells.push({
        id: sqlId,
        projectId,
        versionId,
        createdAt: now,
        updatedAt: now,
        contents: {
          id: sqlId,
          order: `c${i}1`,
          label: `Metric Source ${i}`,
          hidden: true,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          kind: "sql",
          source: "SELECT 1",
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable: df,
          outputResult: true,
        },
      });
      cells.push({
        id: metId,
        projectId,
        versionId,
        createdAt: now,
        updatedAt: now,
        contents: {
          id: metId,
          order: `d${i}1`,
          label: `Headline Metric ${i}`,
          hidden: false,
          gridX: (i - 1) * 4,
          gridY: 0,
          gridWidth: 4,
          gridHeight: 2,
          kind: "metric",
          valueVariableName: df,
          valueRowIndex: 0,
          resultVariable: null,
          outputResult: false,
          format: i === 3 ? "percent" : "number",
        },
      });
      outputs[sqlId] = {
        output: {
          type: "table",
          columns: [{ name: "value", type: "number" }],
          rows: [[i === 3 ? 0.125 : 420 * i]],
          rowCount: 1,
          truncated: false,
        },
      };
    }

    expect(CHART_PANELS.length + 23 + 3).toBe(54);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <AppLayoutSnapshot
              cells={cells}
              outputs={outputs}
              layout={undefined}
              tabBookmark={null}
              onTabChange={vi.fn()}
              canViewSource={false}
              values={{}}
            />
          </AgentNativeI18nProvider>,
        );
      });
      expect(container.querySelectorAll("table")).toHaveLength(23);
      expect(container.textContent).toContain("420");
      expect(container.textContent).toContain("840");
      expect(container.textContent).toContain("12.5");
      expect(container.textContent).not.toContain("Couldn’t update chart");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("logs the underlying transform failure when Couldn’t update chart is shown", async () => {
    const boom = new Error("upstream transform timeout");
    mockUseActionQuery.mockReturnValue({
      data: notebookTransformSchema.parse({
        sources: [],
        result: { status: "unreadable", reason: "result_unreadable" },
      }),
      isPending: false,
      isError: false,
      error: boom,
      refetch: vi.fn(),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <ReadOnlyChart
              context={{
                projectId: "prj-1",
                cellId: "chart-1",
                versionId: "ver-1",
                scope: {
                  releaseId: "ver-1",
                  sessionId: appSessionIdSchema.parse(
                    "00000000-0000-4000-8000-000000000002",
                  ),
                },
                sourceResultId: "res-1",
              }}
              dataframe="panel_1"
              spec={{
                version: 3,
                revision: 1,
                sourceCellId: "sql-1",
                sourceExportId: "result",
                mark: "bar",
                xField: "x-id",
                yField: "y-id",
                seriesField: null,
                title: "Failing panel",
              }}
              dataframes={[]}
            />
          </AgentNativeI18nProvider>,
        );
      });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Couldn’t update chart. Try again.",
      );
      expect(errorSpy).toHaveBeenCalledWith(
        "[CompleteResultChart] failed to update chart",
        expect.objectContaining({
          projectId: "prj-1",
          cellId: "chart-1",
          status: "unreadable",
          reason: "result_unreadable",
          error: boom,
        }),
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
