// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellSchema } from "@/lib/model/contracts";

import {
  defaultTableConfig,
  type TableConfig,
} from "../../../shared/table-visualization-config";
import {
  visualizationPageOutputSchema,
  type VisualizationPageInput,
} from "../../../shared/visualization-contracts";
import { TableCell } from "./TableCell";

import notebookStyles from "./notebook.css?raw";

const actions = vi.hoisted(() => ({
  read: vi.fn(),
  download: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (load) => ({
  ...(await load<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: actions.read,
  useActionMutation: () => ({
    isPending: false,
    isError: false,
    mutate: actions.save,
  }),
  callAction: actions.download,
}));

const config: TableConfig = {
  ...defaultTableConfig,
  source: { cellId: "query", exportId: "result" },
  totals: { amount_id: "sum", segment_id: "count" },
  formatRules: [{ fieldId: "amount_id", op: "gte", value: 100 }],
};

function pageResponse(page: number) {
  const totalRows = 151;
  const start = (page - 1) * 50 + 1;
  return visualizationPageOutputSchema.parse({
    status: "ready",
    sources: [],
    resultId: "source-1",
    columns: [
      { fieldId: "amount_id", name: "Amount", type: "number", nullable: false },
      {
        fieldId: "segment_id",
        name: "Segment",
        type: "string",
        nullable: true,
      },
    ],
    rows: Array.from(
      { length: Math.min(50, totalRows - start + 1) },
      (_, index) => [start + index, "North"],
    ),
    page,
    totalRows,
    totals: [11476, 151],
  });
}

let container: HTMLDivElement;
let styles: HTMLStyleElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  styles = document.createElement("style");
  styles.textContent = notebookStyles;
  document.head.append(styles);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient();
  actions.read.mockImplementation((_name, input: VisualizationPageInput) => ({
    isError: false,
    isPending: false,
    data: pageResponse(input.page ?? 1),
  }));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  styles.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(selectedConfig: TableConfig = config) {
  const cell = cellSchema.parse({
    id: "table",
    projectId: "project",
    versionId: "version",
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    contents: {
      id: "table",
      order: "i",
      kind: "display-table",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      dataframe: null,
      columns: [],
      tableConfig: selectedConfig,
    },
  });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <TableCell cell={cell} canEdit config={selectedConfig} />
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    ),
  );
}

function find<T extends Element>(
  selector: string,
  rootNode: ParentNode = container,
): T {
  const element = rootNode.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

it("pages 50 rows with complete-result totals and conditional formatting on the next page", () => {
  mount();
  expect(container.querySelectorAll("tbody tr")).toHaveLength(50);
  expect(find('tbody th[scope="row"]').textContent).toBe("0");
  expect(
    find('thead svg[aria-label="number"]').classList.contains(
      "tabler-icon-hash",
    ),
  ).toBe(true);
  const numericStyle = getComputedStyle(find("tbody td:first-of-type"));
  expect(numericStyle.textAlign).toBe("right");
  expect(numericStyle.fontVariantNumeric).toBe("tabular-nums");
  expect(find("tfoot").textContent).toContain("11,476");
  expect(container.textContent).toContain("151 rows");
  for (const label of ["View", "Format", "Columns", "Totals"])
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === label,
      ),
    ).toBe(true);
  act(() => find<HTMLButtonElement>('button[aria-label="Next page"]').click());
  expect(actions.read).toHaveBeenLastCalledWith(
    "get-notebook-visualization-page",
    expect.objectContaining({ page: 2, kind: "table", cellId: "table" }),
    expect.any(Object),
  );
  expect(container.querySelectorAll("tbody tr")).toHaveLength(50);
  expect(find("tbody tr:first-child").textContent).toBe("5051North");
  expect(find("tbody tr:last-child td:first-of-type").className).toContain(
    "bg-destructive/15",
  );
  expect(find("tfoot").textContent).toContain("11,476");
});

it("respects the display settings that hide row indexes and type icons", () => {
  mount({
    ...config,
    view: { ...config.view, rowNumbers: false, typeIcons: false },
  });
  expect(container.querySelector('tbody th[scope="row"]')).toBeNull();
  expect(container.querySelector('thead svg[aria-label="number"]')).toBeNull();
  expect(getComputedStyle(find("tbody td:first-of-type")).textAlign).toBe(
    "right",
  );
});

it("saves a header sort by stable field ID after changing the displayed column label", () => {
  mount({ ...config, columns: { amount_id: { label: "Revenue" } } });
  const trigger = find<HTMLButtonElement>(
    'button[aria-label="Options for Revenue"]',
  );
  act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  const sort = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "Sort 9 → 1");
  if (!sort) throw new Error("Missing descending sort menu item");
  act(() => sort.click());
  expect(actions.save).toHaveBeenCalledWith(
    expect.objectContaining({
      cellId: "table",
      expectedUpdatedAt: "2026-11-18T00:00:00.000Z",
      contents: expect.objectContaining({
        tableConfig: expect.objectContaining({
          sort: { fieldId: "amount_id", direction: "desc" },
        }),
      }),
    }),
  );
});

it("rejects an export when any later page comes from another result artifact", async () => {
  mount();
  const createBlobUrl = vi.spyOn(URL, "createObjectURL");
  actions.download.mockImplementation((_name, input: VisualizationPageInput) =>
    Promise.resolve({
      ...pageResponse(input.page ?? 1),
      resultId: input.page === 2 ? "source-2" : "source-1",
    }),
  );
  await act(async () =>
    find<HTMLButtonElement>('button[aria-label="Download CSV"]').click(),
  );
  expect(actions.download).toHaveBeenCalledTimes(2);
  expect(actions.download).toHaveBeenLastCalledWith(
    "get-notebook-visualization-page",
    expect.objectContaining({ page: 2, resultId: "source-1" }),
    expect.any(Object),
  );
  expect(container.textContent).toContain(
    "Couldn’t download the table. Try again.",
  );
  expect(createBlobUrl).not.toHaveBeenCalled();
});
