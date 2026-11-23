// @vitest-environment happy-dom
import { strict as assert } from "node:assert";

import { useActionQuery } from "@agent-native/core/client/hooks";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellSchema, type Cell } from "@/lib/model/contracts";

import { resultIdSchema } from "../../../shared/notebook-execution";
import {
  authorizedResultRefSchema,
  resultFieldSchema,
} from "../../../shared/notebook-result-contract";
import {
  defaultPivotConfig,
  pivotConfigV2Schema,
} from "../../../shared/pivot-config";
import {
  visualizationDrillInputSchema,
  type PivotTransformResult,
  type VisualizationDrillInput,
} from "../../../shared/visualization-contracts";
import { PivotCell } from "./PivotCell";
import { VisualizationDataPanel } from "./VisualizationDataPanel";

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: async () => {},
  writeClientAppState: async () => {},
}));

const source = authorizedResultRefSchema.parse({
  resultId: "orders-result-1",
  snapshot: {
    workspaceId: "workspace-test",
    projectId: "project-test",
    head: { versionId: "draft-test", revision: "4" },
    eventSeq: "4",
  },
  producer: {
    namespaceId: "draft-test",
    cellId: "producer",
    exportId: "result",
    runId: "notebook-run",
    attemptId: "producer-attempt",
    outputGeneration: "producer-generation",
  },
  inputRevision: "4",
  dependencyFingerprint: "source-deps",
  kernelGeneration: null,
  sourceGeneration: null,
});
const fields = resultFieldSchema.array().parse([
  { fieldId: "region", name: "Region", type: "string", nullable: false },
  { fieldId: "channel", name: "Channel", type: "string", nullable: false },
  { fieldId: "product", name: "Product", type: "string", nullable: false },
  { fieldId: "amount", name: "Amount", type: "number", nullable: false },
]);
const config = pivotConfigV2Schema.parse({
  ...defaultPivotConfig,
  revision: 4,
  source: { cellId: "producer", exportId: "result" },
  rows: ["region"],
  columns: ["channel"],
  values: [
    { measureId: "amount-sum", fieldId: "amount", aggregation: "sum" },
    { measureId: "amount-count", fieldId: "amount", aggregation: "count" },
  ],
});
const initialCell = cellSchema.parse({
  id: "pivot",
  projectId: "project-test",
  versionId: "draft-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  contents: {
    id: "pivot",
    kind: "pivot",
    order: "1",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    dataframe: null,
    rows: [],
    columns: [],
    values: [],
    pivotConfig: config,
  },
});

function values(selectionId: string, sum: number, count: number) {
  return [sum, count].map((value) => ({
    kind: "value" as const,
    value,
    selectionId,
  }));
}

const pivot: PivotTransformResult = {
  status: "ready",
  visualizationResultId: "matrix-test",
  source: { fields, result: source, completeness: "complete", rowCount: 4 },
  columns: [["web"], ["store"], null],
  rows: [
    {
      key: ["North"],
      values: [
        ...values("north-web", 50, 2),
        ...values("north-store", 12, 1),
        ...values("north-total", 62, 3),
      ],
    },
    {
      key: ["South"],
      values: [
        ...values("south-web", 84, 1),
        { kind: "missing" },
        { kind: "missing" },
        ...values("south-total", 84, 1),
      ],
    },
    {
      key: null,
      values: [
        ...values("web-total", 134, 3),
        ...values("store-total", 12, 1),
        ...values("grand-total", 146, 4),
      ],
    },
  ],
};

const keys = (target: HTMLElement, key: string) =>
  act(async () => {
    target.focus();
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

async function find<T extends HTMLElement>(selector: string, text?: string) {
  const current = await act(async () =>
    vi.waitFor(() => {
      const element = Array.from(document.querySelectorAll<T>(selector)).find(
        (item) => text === undefined || item.textContent.trim() === text,
      );
      assert(
        element,
        `Missing ${selector}${text ? ` with text "${text}"` : ""}`,
      );
      return element;
    }),
  );
  assert(current);
  return current;
}

it("disables conditional formatting until a Pivot measure exists", () => {
  const html = renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      <VisualizationDataPanel
        config={defaultPivotConfig}
        sources={[]}
        disabled={false}
        onChange={vi.fn()}
      />
    </AgentNativeI18nProvider>,
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  const button = [...host.querySelectorAll("button")].find(
    ({ textContent }) => textContent === "Conditional formatting...",
  );
  expect(button?.disabled).toBe(true);
});

it("drills into the exact Pivot mark, restores its focus, and reopens saved As rows orientation", async () => {
  let storedCell = initialCell;
  const drillCalls: VisualizationDrillInput[] = [];
  const currentProject = () => ({
    project: {
      id: storedCell.projectId,
      workingVersionId: storedCell.versionId,
      cells: [storedCell],
    },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, window.location.href);
    const action = url.pathname.split("/").at(-1);
    const request: unknown =
      typeof init?.body === "string"
        ? JSON.parse(init.body)
        : Object.fromEntries(url.searchParams);
    if (action === "get-actions-batch")
      return new Response(action, { status: 404 });
    if (action === "get-project") return Response.json(currentProject());
    if (action === "get-notebook-transform") {
      assert(storedCell.contents.kind === "pivot");
      return Response.json({
        result: { ...pivot, config: storedCell.contents.pivotConfig },
        sources: [
          {
            binding: { ...config.source, resultId: source.resultId },
            name: "orders",
            fields,
          },
        ],
      });
    }
    if (action === "save-project-cell") {
      assert(request && typeof request === "object" && "contents" in request);
      storedCell = cellSchema.parse({
        ...storedCell,
        contents: request.contents,
        updatedAt: "2026-01-01T00:01:00.000Z",
      });
      return Response.json(currentProject());
    }
    if (action === "open-notebook-visualization-drill") {
      expect(init?.method).toBe("POST");
      const drill = visualizationDrillInputSchema.parse(request);
      drillCalls.push(drill);
      const viewData = drill.mode === "view-data";
      return Response.json({
        status: "ready",
        resultId: "drill-detail",
        columns: viewData ? fields : fields.slice(2),
        rows: viewData
          ? [
              ["North", "web", "A", 42],
              ["North", "web", "B", 8],
            ]
          : [
              ["A", 42],
              ["B", 8],
            ],
        totalRows: 2,
        page: 1,
        filters: [
          { name: "Region", value: "North" },
          { name: "Channel", value: "web" },
        ],
      });
    }
    throw new Error(`Unexpected action: ${String(action)}`);
  });

  function Notebook() {
    const { data } = useActionQuery<ReturnType<typeof currentProject>>(
      "get-project",
      { projectId: initialCell.projectId },
    );
    const cell: Cell | undefined = data?.project.cells[0];
    return cell?.contents.kind === "pivot" ? (
      <PivotCell cell={cell} contents={cell.contents} canEdit />
    ) : null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const newClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let client = newClient();
  let root = createRoot(host);
  async function render() {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <Notebook />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
  }

  try {
    await render();
    const mark = await find<HTMLButtonElement>(
      'button[aria-label="North, web, Sum of Amount, 50"]',
    );
    const count = await find<HTMLButtonElement>(
      'button[aria-label="North, web, Count of Amount, 2"]',
    );
    expect(mark.tabIndex).toBe(0);
    expect(count.tabIndex).toBe(-1);
    await keys(mark, "ArrowRight");
    expect(document.activeElement).toBe(count);
    await keys(count, "ArrowLeft");
    expect(document.activeElement).toBe(mark);
    await find('button[aria-label="Total, Total, Sum of Amount, 146"]');
    await find("span.sr-only", "No matching rows");

    await keys(mark, "Enter");
    await act(async () =>
      (await find('[role="menuitem"]', "View data")).click(),
    );
    await find("h3", "Viewing Region = North · Channel = web");
    const detail = await find("section table");
    expect(
      [...detail.querySelectorAll("tbody td:nth-child(4)")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["42", "8"]);
    expect(drillCalls.at(-1)).toMatchObject({
      visualizationResultId: "matrix-test",
      selectionId: "north-web",
      mode: "view-data",
      page: 1,
    });
    await act(async () =>
      (await find('button[aria-label="Close drill"]')).click(),
    );
    await act(async () =>
      vi.waitFor(() => expect(document.activeElement).toBe(mark)),
    );

    await keys(mark, "Enter");
    await keys(await find('[role="menuitem"]', "Drill down..."), "ArrowRight");
    await act(async () => (await find('[role="menuitem"]', "Product")).click());
    await find("h3", "Viewing Region = North · Channel = web");
    const groups = await find("section table");
    expect(
      [...groups.querySelectorAll('tbody th[scope="row"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["A", "B"]);
    expect(drillCalls.at(-1)).toMatchObject({
      selectionId: "north-web",
      mode: "drill-down",
      nextFieldId: "product",
    });
    await act(async () =>
      (await find('button[aria-label="Drill up"]')).click(),
    );
    await act(async () =>
      vi.waitFor(() => expect(document.activeElement).toBe(mark)),
    );
    expect(mark.textContent).toBe("50");

    await keys(
      await find('[role="combobox"][aria-label="As columns"]'),
      "Enter",
    );
    await keys(await find('[role="option"]', "As rows"), "Enter");
    await act(async () =>
      vi.waitFor(() => {
        assert(storedCell.contents.kind === "pivot");
        expect(storedCell.contents.pivotConfig).toMatchObject({
          revision: 5,
          orientation: "rows",
        });
      }),
    );
    await act(async () => root.unmount());
    client.clear();
    root = createRoot(host);
    client = newClient();
    await render();
    await find('[role="combobox"][aria-label="As rows"]');
    expect(await find('th[rowspan="2"]', "North")).not.toBeNull();
    await find('button[aria-label="North, web, Sum of Amount, 50"]');
    const formatting = await find<HTMLButtonElement>(
      "button",
      "Conditional formatting...",
    );
    expect(formatting.disabled).toBe(false);
    await act(async () => formatting.click());
    const condition = await find<HTMLInputElement>('input[aria-label="Value"]');
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      assert(setValue);
      setValue.call(condition, "80");
      condition.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      (await find<HTMLButtonElement>('button[type="submit"]', "Save")).click(),
    );
    await act(async () =>
      vi.waitFor(() => {
        assert(storedCell.contents.kind === "pivot");
        expect(storedCell.contents.pivotConfig).toMatchObject({
          revision: 6,
          formatRules: [{ measureId: "amount-sum", op: "gt", value: 80 }],
        });
      }),
    );
    const selected = await find(
      'button[aria-label="South, web, Sum of Amount, 84"]',
    );
    const unselected = await find(
      'button[aria-label="North, web, Sum of Amount, 50"]',
    );
    expect(
      selected.closest("td")?.classList.contains("bg-destructive/15"),
    ).toBe(true);
    expect(
      unselected.closest("td")?.classList.contains("bg-destructive/15"),
    ).toBe(false);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("rerenders a draft pivot when its producer replaces the result without changing the pivot config", async () => {
  assert(initialCell.contents.kind === "pivot");
  const contents = initialCell.contents;
  const emptyResult: PivotTransformResult = {
    ...pivot,
    status: "empty",
    source: {
      ...pivot.source,
      result: { ...source, resultId: resultIdSchema.parse("orders-empty") },
      rowCount: 0,
    },
    visualizationResultId: "matrix-empty",
    rows: [],
    columns: [],
  };
  const zeroResult: PivotTransformResult = {
    ...pivot,
    source: {
      ...pivot.source,
      result: { ...source, resultId: resultIdSchema.parse("orders-with-zero") },
      rowCount: 5,
    },
    visualizationResultId: "matrix-with-zero",
    rows: pivot.rows.map((row) =>
      row.key?.[0] === "South"
        ? {
            ...row,
            values: [
              ...row.values.slice(0, 2),
              ...values("south-store", 0, 1),
              ...row.values.slice(4),
            ],
          }
        : row,
    ),
  };
  let current = pivot;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input, window.location.href);
    expect(url.pathname.split("/").at(-1)).toBe("get-notebook-transform");
    return Response.json({
      result: { ...current, config },
      sources: [
        {
          binding: {
            ...config.source,
            resultId: current.source.result.resultId,
          },
          name: "orders",
          fields,
        },
      ],
    });
  });
  const host = document.createElement("div");
  document.body.append(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(host);
  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <PivotCell
              cell={initialCell}
              contents={contents}
              canEdit
              sourceResultId={current.source.result.resultId}
            />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
  try {
    await render();
    await find("span.sr-only", "No matching rows");
    expect(
      host.querySelector('button[aria-label="South, store, Sum of Amount, 0"]'),
    ).toBeNull();
    current = zeroResult;
    await render();
    await find('button[aria-label="South, store, Sum of Amount, 0"]');
    expect(host.querySelector("td .sr-only")).toBeNull();
    current = emptyResult;
    await render();
    await find("span", "0 rows");
    expect(host.querySelector("tbody tr")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});
