// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { cellSchema, type ChartSpec } from "@/lib/model/contracts";
import { pickSelect, selectTrigger } from "@/testing/select";

import {
  defaultChartSpec,
  migrateChartSpec,
} from "../../../shared/chart-visualization-config";
import { appSessionIdSchema } from "../../../shared/notebook-execution";
import {
  completeResultManifestSchema,
  resultFieldSchema,
} from "../../../shared/notebook-result-contract";
import { notebookTransformSchema } from "../../../shared/visualization-contracts";
import { usePublishedResultPages } from "../published/usePublishedResultPages";
import { projectChartDataframes } from "./chart-config";
import { CompleteChartEditor } from "./CompleteResultChart";
import { ReadOnlyChart } from "./ReadOnlyChart";

const { invoke, query } = vi.hoisted(() => ({
  invoke: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: invoke,
  useActionQuery: query,
}));
vi.mock("./VisualizationDrillPanel", () => ({
  VisualizationDrillPanel: () => null,
  useVisualizationSelection: vi.fn(),
}));
vi.mock("./VegaChart", async () => {
  const { ChartDrawing } = await import("./ChartDrawing");
  return { VegaChart: ChartDrawing };
});
vi.mock("@agent-native/core/client/i18n", async () => ({
  ...(await import("../../skins/reference/testing/i18n")).i18nMock,
  useOptionalLocale: () => null,
}));

const context = {
  projectId: "project",
  cellId: "chart",
  versionId: "draft",
};
const binding = { cellId: "sql", exportId: "result", resultId: "artifact" };
const fields = [
  resultFieldSchema.parse({
    fieldId: "date-id",
    name: "CREATED_DATE",
    type: "date",
    nullable: false,
  }),
  resultFieldSchema.parse({
    fieldId: "arr-id",
    name: "ARR",
    type: "number",
    nullable: false,
  }),
  resultFieldSchema.parse({
    fieldId: "region-id",
    name: "Region",
    type: "string",
    nullable: false,
  }),
];
const source = {
  result: {
    resultId: "artifact",
    snapshot: {
      workspaceId: "workspace",
      projectId: context.projectId,
      head: { versionId: context.versionId, revision: "1" },
      eventSeq: "1",
    },
    producer: {
      cellId: binding.cellId,
      exportId: binding.exportId,
      namespaceId: "namespace",
      runId: "run",
      attemptId: "attempt",
      outputGeneration: "generation",
    },
    inputRevision: "1",
    dependencyFingerprint: "fingerprint",
    kernelGeneration: null,
    sourceGeneration: null,
  },
  fields,
  completeness: "complete",
  rowCount: 20_000,
};
const defaultSpec = defaultChartSpec(binding);
const spec: ChartSpec = {
  ...defaultSpec,
  xField: "date-id",
  yField: "arr-id",
  seriesField: "region-id",
  title: "Monthly revenue",
};
const groupedRows = [
  { x: "2025-01-01", series: "South", value: 125, selectionId: "mark-south" },
  { x: "2025-01-01", series: "North", value: 480, selectionId: "mark-north" },
];
const dataframes = [
  {
    name: "old_export",
    cellId: binding.cellId,
    resultId: binding.resultId,
    columns: fields,
    rows: [["2025-01-23", 2, "South"]],
  },
];

function mockProjection(rows?: typeof groupedRows, name = "renamed_export") {
  query.mockReturnValue({
    data: notebookTransformSchema.parse({
      sources: [{ name, binding, fields }],
      result: rows
        ? {
            kind: "chart",
            status: rows.length ? "ready" : "empty",
            visualizationResultId: "chart-result",
            source,
            categories: ["North", "South"],
            rows,
          }
        : { status: "unconfigured" },
    }),
    isPending: false,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders a published unversioned chart beyond the first result page", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const sessionId = appSessionIdSchema.parse("session");
  const sql = cellSchema.parse({
    id: binding.cellId,
    projectId: context.projectId,
    versionId: "release",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    contents: {
      id: binding.cellId,
      kind: "sql",
      order: "a1",
      label: null,
      hidden: true,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      source: "SELECT 1",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: "old_export",
      outputResult: true,
    },
  });
  const legacy: ChartSpec = {
    ...spec,
    version: undefined,
    sourceCellId: undefined,
    sourceExportId: undefined,
    xField: "CREATED_DATE",
    yField: "ARR",
    yFields: [],
    seriesField: "Region",
  };
  invoke.mockResolvedValue({
    status: "ready",
    manifest: completeResultManifestSchema.parse({
      status: "complete",
      result: source.result,
      fields,
      rowCount: "20000",
    }),
    page: 1,
    rows: Array.from({ length: 50 }, () => ["2025-01-23", 2, "South"]),
  });
  query.mockClear();
  mockProjection(
    [
      ...groupedRows,
      {
        x: "2025-12-01",
        series: "South",
        value: 999,
        selectionId: "late-period",
      },
    ],
    "old_export",
  );
  function PublishedChart() {
    const { outputs } = usePublishedResultPages(
      [{ cellId: binding.cellId, resultId: binding.resultId }],
      { sessionId },
    );
    return (
      <ReadOnlyChart
        context={{
          ...context,
          scope: { releaseId: "release", sessionId },
        }}
        dataframe="old_export"
        spec={legacy}
        dataframes={projectChartDataframes([sql], outputs)}
      />
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <PublishedChart />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(
        [
          ...host.querySelectorAll(
            '[role="graphics-symbol"][aria-label], [data-chart-mark][aria-label]',
          ),
        ].map((mark) => mark.getAttribute("aria-label")),
      ).toContainEqual(expect.stringContaining("999")),
    );
    expect(query).toHaveBeenCalledWith(
      "get-notebook-transform",
      expect.objectContaining({ releaseId: "release", sessionId: "session" }),
      expect.objectContaining({ queryKeyScope: [binding.resultId] }),
    );
  } finally {
    act(() => root.unmount());
    host.remove();
    client.clear();
    invoke.mockReset();
    query.mockReset();
  }
});

it("mounts a bound stacked column with blank axes and saves stable field IDs", () => {
  mockProjection();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    act(() =>
      root.render(
        <CompleteChartEditor
          context={context}
          spec={defaultSpec}
          dataframe="old_export"
          dataframes={dataframes}
          disabled={false}
          onChange={change}
        />,
      ),
    );
    expect(selectTrigger(host, "X-axis").textContent).toBe("No X-axis");
    expect(selectTrigger(host, "Y-axis").textContent).toBe("No Y-axis");
    expect(host.querySelector('[aria-label="Chart type"]')?.textContent).toBe(
      "Stacked column",
    );
    expect(selectTrigger(host, "DataFrame").textContent).toBe("renamed_export");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Choose an X-axis and a Y-axis column to draw this chart.",
    );
    const appearance = [...host.querySelectorAll("details")].find(
      (details) =>
        details.querySelector("summary")?.textContent === "Appearance",
    );
    expect(appearance?.open).toBe(false);
    const tooltip = [...(appearance?.querySelectorAll("label") ?? [])]
      .find((label) => label.textContent === "Include X, Y, Color & Facet")
      ?.querySelector<HTMLInputElement>("input");
    expect(tooltip?.checked).toBe(true);
    pickSelect(host, "X-axis", "CREATED_DATE");
    expect(change).toHaveBeenCalledWith({
      chartSpec: {
        version: 3,
        xField: "date-id",
        fieldLabels: { "date-id": "CREATED_DATE" },
      },
    });
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it.each([
  { cellId: "replacement", exportId: "result" },
  { cellId: binding.cellId, exportId: "symbol:replacement" },
])("keeps compatible chart fields when selecting $exportId", (nextBinding) => {
  const replacement = {
    ...nextBinding,
    resultId: "new-artifact",
  };
  const replacementFields = [
    resultFieldSchema.parse({ ...fields[1], fieldId: "new-amount" }),
    resultFieldSchema.parse({ ...fields[0], fieldId: "new-date" }),
    resultFieldSchema.parse({ ...fields[2], fieldId: "new-region" }),
  ];
  query.mockReturnValue({
    data: notebookTransformSchema.parse({
      sources: [
        { name: "renamed_export", binding, fields },
        {
          name: "replacement",
          binding: replacement,
          fields: replacementFields,
        },
      ],
      result: { status: "unconfigured" },
    }),
    isPending: false,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    act(() =>
      root.render(
        <CompleteChartEditor
          context={context}
          spec={spec}
          dataframe="old_export"
          dataframes={dataframes}
          disabled={false}
          onChange={change}
        />,
      ),
    );
    pickSelect(host, "DataFrame", "replacement");
    expect(change).toHaveBeenCalledExactlyOnceWith({
      dataframe: "replacement",
      chartSpec: {
        version: 3,
        sourceCellId: replacement.cellId,
        sourceExportId: replacement.exportId,
        filters: [],
        excludedMarks: [],
        xField: "new-date",
        yField: "new-amount",
        yFields: [],
        seriesField: "new-region",
        yAggregation: undefined,
        countRecords: false,
        fieldLabels: {
          "new-date": "CREATED_DATE",
          "new-amount": "ARR",
          "new-region": "Region",
        },
      },
    });
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("labels monthly buckets in the chart Table while preserving their grouped values", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockProjection(groupedRows);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <CompleteChartEditor
          context={context}
          spec={spec}
          dataframe="old_export"
          dataframes={dataframes}
          disabled={false}
        />,
      ),
    );
    const table = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Table",
    );
    if (!table) throw new Error("Missing chart Table control");
    act(() => table.click());
    expect(
      [...host.querySelectorAll("tbody tr")].map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["Jan 2025", "South", "125"],
      ["Jan 2025", "North", "480"],
    ]);
  } finally {
    act(() => root.unmount());
  }
});

it.each([342, 390])(
  "draws the complete aggregate with keyboard marks at %i px and retains color through filtering",
  (width) => {
    vi.spyOn(SVGSVGElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width }),
    );
    mockProjection(groupedRows);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const paint = () =>
      act(() =>
        root.render(
          <ReadOnlyChart
            context={{ ...context, scope: { releaseId: "release" } }}
            dataframe="old_export"
            spec={spec}
            dataframes={dataframes}
          />,
        ),
      );
    try {
      paint();
      expect(query).toHaveBeenCalledWith(
        "get-notebook-transform",
        expect.objectContaining({ releaseId: "release" }),
        expect.anything(),
      );
      const chart = host.querySelector("svg");
      expect(chart?.getAttribute("viewBox")).toBe(`0 0 ${width} 260`);
      expect(chart?.getAttribute("preserveAspectRatio")).not.toBe("none");
      const marks = [
        ...host.querySelectorAll<SVGElement>("rect[data-chart-mark]"),
      ];
      expect(marks).toHaveLength(2);
      expect(marks[0]?.getAttribute("aria-label")).toContain("Sum of ARR: 125");
      expect(marks[0]?.getAttribute("aria-label")).toContain(
        "Month of CREATED_DATE",
      );
      expect(marks[0]?.style.getPropertyValue("--nb-series-color")).toBe(
        "var(--nb-tableau-2)",
      );
      expect(marks[1]?.style.getPropertyValue("--nb-series-color")).toBe(
        "var(--nb-tableau-1)",
      );
      act(() =>
        marks[0]?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
      expect(host.textContent).toContain("View data");
      mockProjection(groupedRows.slice(0, 1));
      paint();
      expect(
        host
          .querySelector<SVGElement>("rect[data-chart-mark]")
          ?.style.getPropertyValue("--nb-series-color"),
      ).toBe("var(--nb-tableau-2)");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  },
);

it("maps unique legacy display names and rejects duplicate or missing field names", () => {
  const legacy: ChartSpec = {
    ...spec,
    version: 2,
    xField: "CREATED_DATE",
    yField: "ARR",
    seriesField: "Region",
  };
  expect(migrateChartSpec(legacy, binding, fields)).toMatchObject({
    version: 3,
    sourceCellId: binding.cellId,
    sourceExportId: binding.exportId,
    xField: "date-id",
    yField: "arr-id",
    seriesField: "region-id",
  });
  expect(migrateChartSpec(legacy, binding, [...fields, ...fields])).toBeNull();
  expect(migrateChartSpec(legacy, binding, fields.slice(0, 2))).toBeNull();
});

it.each([
  spec,
  {
    ...spec,
    version: 2,
    xField: "CREATED_DATE",
    yField: "ARR",
    seriesField: "Region",
  } satisfies ChartSpec,
])(
  "distinguishes an empty artifact from a rejected field binding for chart version $version",
  (chartSpec) => {
    mockProjection([]);
    const host = document.createElement("div");
    const root = createRoot(host);
    const paint = () =>
      act(() =>
        root.render(
          <ReadOnlyChart
            context={context}
            dataframe="previous_name"
            spec={chartSpec}
            dataframes={dataframes}
          />,
        ),
      );
    try {
      paint();
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "No data",
      );
      query.mockReturnValue({
        data: notebookTransformSchema.parse({
          sources: [{ name: "renamed_export", binding, fields }],
          result: {
            status: "blocked",
            reason: "visualization_binding_invalid",
          },
        }),
        isPending: false,
      });
      paint();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "Couldn’t update chart.",
      );
      expect(host.textContent).not.toContain("No data");
    } finally {
      act(() => root.unmount());
    }
  },
);

it.each([
  ["Keep", "keep"],
  ["Remove", "remove"],
] as const)(
  "applies %s to the exact server-resolved chart mark",
  async (label, mode) => {
    mockProjection(groupedRows);
    const predicates = [
      { fieldId: "date-id", op: "gte", value: "2025-01-01" },
      { fieldId: "date-id", op: "lt", value: "2025-02-01" },
      { fieldId: "region-id", op: "eq", value: "South" },
    ];
    invoke.mockResolvedValue({ status: "ready", predicate: predicates });
    const host = document.createElement("div");
    const root = createRoot(host);
    const change = vi.fn();
    try {
      act(() =>
        root.render(
          <CompleteChartEditor
            context={context}
            spec={spec}
            dataframe="old_export"
            dataframes={dataframes}
            disabled={false}
            onChange={change}
          />,
        ),
      );
      const mark = host.querySelector("rect[data-chart-mark]");
      if (!mark) throw new Error("Missing chart mark");
      act(() =>
        mark.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
      const button = [...host.querySelectorAll("button")].find(
        (node) => node.textContent === label,
      );
      if (!button) throw new Error(`Missing ${label} action`);
      await act(async () => button.click());
      expect(invoke).toHaveBeenCalledWith(
        "open-notebook-visualization-drill",
        {
          projectId: context.projectId,
          cellId: context.cellId,
          visualizationResultId: "chart-result",
          selectionId: "mark-south",
          requestId: expect.any(String),
          mode,
        },
        expect.objectContaining({ method: "POST" }),
      );
      expect(change).toHaveBeenCalledWith({
        chartSpec: {
          version: 3,
          fieldLabels: {
            "arr-id": "ARR",
            "date-id": "CREATED_DATE",
            "region-id": "Region",
          },
          ...(mode === "keep"
            ? { filters: predicates }
            : { excludedMarks: [predicates] }),
        },
      });
    } finally {
      act(() => root.unmount());
    }
  },
);
