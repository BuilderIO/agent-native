// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type {
  DataTableColumn,
  DataTableDetails,
} from "@/lib/model/data-table-contracts";

import { DataTableDetail, isRetryableTableReadError } from "./DataTableDetail";

const hooks = vi.hoisted(() => ({ useActionQuery: vi.fn() }));

vi.mock("./DataFavorites", () => ({ DataTableFavorite: () => null }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: () => {} }),
  useActionQuery: hooks.useActionQuery,
}));

const REACT_ACT_ENVIRONMENT = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
REACT_ACT_ENVIRONMENT.IS_REACT_ACT_ENVIRONMENT = true;

const CONNECTION_ID = "connection-1";
const TABLE_ID = "table:qa-project:qa-dataset:qa_table";
const NEXT_TABLE_ID = "table:qa-project:qa-dataset:next_table";

type QueryState = {
  data: DataTableDetails | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
};

let state: QueryState;

function column(
  name: string,
  overrides: Partial<DataTableColumn> = {},
): DataTableColumn {
  return {
    name,
    type: "STRING",
    mode: "NULLABLE",
    description: null,
    fields: [],
    ...overrides,
  };
}

function details(
  columns: readonly DataTableColumn[],
  overrides: Partial<DataTableDetails["table"]> = {},
  connectionId = CONNECTION_ID,
): DataTableDetails {
  return {
    connectionId,
    table: {
      projectId: "qa-project",
      datasetId: "qa-dataset",
      tableId: overrides.name ?? "qa_table",
      name: "qa_table",
      type: "TABLE",
      description: "Provider table description",
      numRows: "1234",
      numBytes: "2048",
      lastModifiedTime: null,
      columnCount: columns.length,
      columns: [...columns],
      ...overrides,
    },
  };
}

function manyColumns(count: number): DataTableColumn[] {
  return Array.from({ length: count }, (_, index) =>
    column(`column_${index + 1}`, {
      description: index === 0 ? "First column description" : null,
    }),
  );
}

const mounted: { container: HTMLDivElement; root: Root }[] = [];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function settleDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
  await flush();
}

function baseProps() {
  return {
    connectionId: CONNECTION_ID,
    connectionName: "QA warehouse",
    tableId: TABLE_ID,
    tableName: "qa_table",
  };
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient();
  mounted.push({ container, root });
  const update = async (props: ReturnType<typeof baseProps>) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <DataTableDetail {...props} />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    await flush();
  };
  await update(baseProps());
  return { container, update };
}

function button(container: HTMLElement, label: string): HTMLButtonElement;
function button(
  container: HTMLElement,
  label: string,
  required: false,
): HTMLButtonElement | undefined;
function button(
  container: HTMLElement,
  label: string,
  required = true,
): HTMLButtonElement | undefined {
  const found = [...container.querySelectorAll("button")].find((element) =>
    (element.textContent ?? "").includes(label),
  );
  if (!found && required) throw new Error(`No button containing "${label}"`);
  return found as HTMLButtonElement | undefined;
}

function columnNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".data-table-detail-column-name")].map(
    (element) => element.textContent ?? "",
  );
}

function headers(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll(".data-page-source-table thead th"),
  ].map((element) => element.textContent ?? "");
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await flush();
}

async function typeFilter(
  container: HTMLElement,
  value: string,
): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search columns"]',
  );
  if (!input) throw new Error("Column search is not open");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  hooks.useActionQuery.mockReset();
  state = {
    data: undefined,
    isPending: true,
    isError: false,
    error: undefined,
    refetch: vi.fn(async () => {}),
  };
  hooks.useActionQuery.mockImplementation((name: string) =>
    name === "get-data-table-preview"
      ? {
          data: {
            connectionId: CONNECTION_ID,
            tableId: TABLE_ID,
            columns: ["alpha"],
            rows: [["actual row"]],
          },
          isPending: false,
          isFetching: false,
          isError: false,
          error: undefined,
          refetch: state.refetch,
        }
      : state,
  );
});

afterEach(async () => {
  for (const { container, root } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.clearAllMocks();
});

describe("DataTableDetail", () => {
  it("reads one table through the read-only action with automatic retry disabled", async () => {
    const { container } = await mount();

    expect(hooks.useActionQuery).toHaveBeenNthCalledWith(
      1,
      "get-data-table-details",
      { connectionId: CONNECTION_ID, tableId: TABLE_ID },
      { retry: false },
    );
    expect(hooks.useActionQuery).toHaveBeenLastCalledWith(
      "get-data-table-preview",
      { connectionId: CONNECTION_ID, tableId: TABLE_ID },
      { enabled: false, retry: false },
    );
    const loading = container.querySelector(
      '[role="status"][aria-label="Loading table details"]',
    );
    expect(loading).not.toBeNull();
    expect(headers(container)).toEqual([]);
  });

  it("shows actual preview rows and retains the columns path", async () => {
    state.isPending = false;
    state.data = details([column("alpha")]);
    const { container } = await mount();

    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Preview",
      "Columns (1)",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("actual row");
    expect(headers(container)).toEqual(["alpha"]);

    await click(button(container, "Columns"));

    expect(
      [...container.querySelectorAll('[role="tab"]')][1]?.getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(columnNames(container)).toEqual(["alpha"]);
  });

  it("renders every actual column as one flat row without an unfiltered header", async () => {
    state.isPending = false;
    state.data = details(
      [
        column("column_1", {
          type: "RECORD",
          description: "First column description",
          fields: [
            column("child_field", { description: "Nested description" }),
          ],
        }),
        ...manyColumns(1001).slice(1),
      ],
      { description: "Provider table description" },
    );
    const { container } = await mount();

    expect(container.textContent).toContain("Columns (1001)");
    expect(container.textContent).toContain("Provider table description");
    await click(button(container, "Columns"));

    // Flat provider-source rows; record children are not expanded.
    expect(headers(container)).toEqual([]);
    expect(container.textContent).not.toContain("COLUMNS (");
    const rows = [
      ...container.querySelectorAll(".data-page-source-table tbody tr"),
    ];
    expect(rows).toHaveLength(1001);
    expect(rows.some((row) => row.hasAttribute("data-depth"))).toBe(false);
    expect(columnNames(container).slice(0, 2)).toEqual([
      "column_1",
      "column_2",
    ]);
    expect(container.textContent).toContain("First column description");
    expect(container.textContent).toContain("RECORD");
    expect(container.textContent).toContain("column_1001");
    expect(container.textContent).not.toContain("child_field");
    expect(container.textContent).not.toContain("Nested description");
  });

  it("filters only the flat display names and adds the conditional matching header", async () => {
    state.isPending = false;
    state.data = details([
      column("alpha"),
      column("beta"),
      column("nested", {
        type: "RECORD",
        fields: [column("gamma")],
      }),
    ]);
    const { container } = await mount();
    await click(button(container, "Columns"));
    await click(button(container, "Search columns"));

    await typeFilter(container, "BET");
    await settleDebounce();

    expect(headers(container)).toEqual(['1 column matching "bet"']);
    expect(columnNames(container)).toEqual(["beta"]);
    expect(
      container.querySelector(".data-table-detail-column-name mark")
        ?.textContent,
    ).toBe("bet");

    // Record children do not create independently searchable rows.
    await typeFilter(container, "gamma");
    await settleDebounce();

    expect(headers(container)).toEqual(['0 columns matching "gamma"']);
    expect(columnNames(container)).toEqual([]);
    expect(
      container.querySelectorAll(".data-page-source-table tbody tr"),
    ).toHaveLength(0);
  });

  it("applies the first filter change immediately and trailing changes after the 200 ms window", async () => {
    state.isPending = false;
    state.data = details([column("alpha"), column("beta")]);
    const { container } = await mount();
    await click(button(container, "Columns"));
    await click(button(container, "Search columns"));

    await typeFilter(container, "alp");
    // Leading edge: no 200 ms wait.
    expect(headers(container)).toEqual(['1 column matching "alp"']);
    expect(columnNames(container)).toEqual(["alpha"]);

    await typeFilter(container, "bet");
    // Trailing edge: still inside the first change's window.
    expect(headers(container)).toEqual(['1 column matching "alp"']);
    expect(columnNames(container)).toEqual(["alpha"]);

    await settleDebounce();
    expect(headers(container)).toEqual(['1 column matching "bet"']);
    expect(columnNames(container)).toEqual(["beta"]);
  });

  it("retries an explicitly retryable read failure only when Retry is pressed", async () => {
    state.isPending = false;
    state.isError = true;
    state.error = Object.assign(
      new Error("The table AI policy is unavailable. Please try again."),
      { statusCode: 503, errorCode: "data_table_ai_policy_pending" },
    );
    const { container } = await mount();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "The table AI policy is unavailable. Please try again.",
    );
    expect(state.refetch).not.toHaveBeenCalled();
    await click(button(container, "Retry"));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("never offers or forwards Retry for a 403 denial", async () => {
    state.isPending = false;
    state.isError = true;
    state.error = Object.assign(
      new Error("You do not have access to the data browser."),
      { statusCode: 403, errorCode: "data_table_access_denied" },
    );
    const { container } = await mount();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "You do not have access to the data browser.",
    );
    expect(button(container, "Retry", false)).toBeUndefined();
    expect(state.refetch).not.toHaveBeenCalled();
  });

  it("never offers or forwards Retry for a 409 conflict", async () => {
    state.isPending = false;
    state.isError = true;
    state.error = Object.assign(
      new Error("This data connection is not connected."),
      { statusCode: 409, errorCode: "data_connection_not_connected" },
    );
    const { container } = await mount();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This data connection is not connected.",
    );
    expect(button(container, "Retry", false)).toBeUndefined();
    expect(state.refetch).not.toHaveBeenCalled();
  });

  it("treats denial and conflict failures as non-retryable even without a status code", () => {
    expect(
      isRetryableTableReadError({
        message: "denied",
        errorCode: "data_table_access_denied",
      }),
    ).toBe(false);
    expect(
      isRetryableTableReadError({
        message: "conflict",
        errorCode: "data_connection_not_connected",
      }),
    ).toBe(false);
    expect(isRetryableTableReadError(new Error("network"))).toBe(true);
    expect(isRetryableTableReadError({ status: 408 })).toBe(true);
    expect(isRetryableTableReadError({ status: 429 })).toBe(true);
    expect(isRetryableTableReadError({ status: 422 })).toBe(false);
  });

  it("does not paint a previous table's columns into a new selection while it loads", async () => {
    state.isPending = false;
    state.data = details(manyColumns(3));
    const { container, update } = await mount();
    await click(button(container, "Columns"));
    expect(columnNames(container)).toEqual([
      "column_1",
      "column_2",
      "column_3",
    ]);

    // The selection moved; the hook still holds the old payload.
    state.isPending = true;
    await update({
      ...baseProps(),
      tableId: NEXT_TABLE_ID,
      tableName: "next_table",
    });

    expect(container.querySelector("h2")?.textContent).toBe("next_table");
    expect(
      container.querySelector(
        '[role="status"][aria-label="Loading table details"]',
      ),
    ).not.toBeNull();
    expect(columnNames(container)).toEqual([]);
    expect(container.textContent).not.toContain("column_1");

    state.isPending = false;
    state.data = details([column("next_column")], { name: "next_table" });
    await update({
      ...baseProps(),
      tableId: NEXT_TABLE_ID,
      tableName: "next_table",
    });

    expect(columnNames(container)).toEqual(["next_column"]);
    expect(container.textContent).toContain("Columns (1)");
  });

  it("ignores a response whose connection does not match the selection", async () => {
    state.isPending = false;
    state.data = details(
      [column("other_connection_column")],
      {},
      "connection-2",
    );
    const { container } = await mount();

    expect(columnNames(container)).toEqual([]);
    expect(container.textContent).not.toContain("other_connection_column");
    expect(
      container.querySelector(
        '[role="status"][aria-label="Loading table details"]',
      ),
    ).not.toBeNull();
  });

  it("shows the source empty state only for an empty column read", async () => {
    state.isPending = false;
    state.data = details([], { columnCount: 0 });
    const { container } = await mount();
    await click(button(container, "Columns"));

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "No columns found",
    );
    expect(container.querySelector(".data-page-source-table")).toBeNull();
  });

  it("keeps the preview header and shows an empty-row message for a zero-row preview", async () => {
    state.isPending = false;
    state.data = details([column("alpha")]);
    hooks.useActionQuery.mockImplementation((name: string) =>
      name === "get-data-table-preview"
        ? {
            data: {
              connectionId: CONNECTION_ID,
              tableId: TABLE_ID,
              columns: ["alpha", "beta"],
              rows: [],
            },
            isPending: false,
            isFetching: false,
            isError: false,
            error: undefined,
            refetch: state.refetch,
          }
        : state,
    );
    const { container } = await mount();

    expect(headers(container)).toEqual(["alpha", "beta"]);
    const empty = container.querySelector("tbody td[role='status']");
    expect(empty?.textContent).toContain("This table has no rows");
    expect(empty?.getAttribute("colspan")).toBe("2");
  });

  it("filters preview columns and row cells by the Search columns input", async () => {
    state.isPending = false;
    state.data = details([column("alpha"), column("beta"), column("gamma")]);
    hooks.useActionQuery.mockImplementation((name: string) =>
      name === "get-data-table-preview"
        ? {
            data: {
              connectionId: CONNECTION_ID,
              tableId: TABLE_ID,
              columns: ["alpha", "beta", "gamma"],
              rows: [
                ["a1", "b1", "g1"],
                ["a2", "b2", "g2"],
              ],
            },
            isPending: false,
            isFetching: false,
            isError: false,
            error: undefined,
            refetch: state.refetch,
          }
        : state,
    );
    const { container } = await mount();

    expect(headers(container)).toEqual(["alpha", "beta", "gamma"]);
    await click(button(container, "Search columns"));
    const input = container.querySelector(
      'input[aria-label="Search columns"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "bet");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settleDebounce();

    expect(headers(container)).toEqual(["beta"]);
    const cellTexts = [...container.querySelectorAll("tbody td")].map(
      (cell) => cell.textContent,
    );
    expect(cellTexts).toEqual(["b1", "b2"]);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "zzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settleDebounce();

    expect(headers(container)).toEqual(['0 columns matching "zzz"']);
  });

  it("clears selected column detail when switching tables", async () => {
    state.isPending = false;
    state.data = details([column("alpha", { description: "First col" })]);
    const { container, update } = await mount();
    await click(button(container, "Columns"));
    await click(button(container, "alpha"));

    expect(container.textContent).toContain("First col");
    expect(container.querySelector(".data-dbt-column-detail")).not.toBeNull();

    state.data = details([column("next_column")], { name: "next_table" });
    await update({
      ...baseProps(),
      tableId: NEXT_TABLE_ID,
      tableName: "next_table",
    });

    state.data = details([column("alpha", { description: "First col" })]);
    await update(baseProps());

    expect(container.querySelector(".data-dbt-column-detail")).toBeNull();
  });

  it("supports ArrowRight and ArrowLeft keyboard navigation on the detail tablist", async () => {
    state.isPending = false;
    state.data = details([column("alpha")]);
    const { container } = await mount();

    const previewTab = button(container, "Preview")!;
    const columnsTab = button(container, "Columns")!;
    expect(previewTab.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      previewTab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(columnsTab.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      columnsTab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(previewTab.getAttribute("aria-selected")).toBe("true");
  });
});
