// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { DataTableDetail } from "./DataTableDetail";

const reads = vi.hoisted(() => ({
  dbt: undefined as unknown,
  providerDescription: null as string | null,
  dbtError: false,
}));
vi.mock("./DataFavorites", () => ({ DataTableFavorite: () => null }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: () => {} }),
  useActionQuery: (name: string) => ({
    data:
      name === "get-data-dbt-metadata"
        ? reads.dbt
        : {
            connectionId: "qa-connection",
            table: {
              projectId: "qa",
              datasetId: "public",
              tableId: "orders",
              name: "orders",
              type: "TABLE",
              description: reads.providerDescription,
              columns: [
                {
                  name: "id",
                  type: "STRING",
                  mode: "NULLABLE",
                  description: null,
                  fields: [],
                },
                {
                  name: "other_id",
                  type: "STRING",
                  mode: "NULLABLE",
                  description: null,
                  fields: [],
                },
              ],
              columnCount: 2,
            },
          },
    isPending: false,
    isError: name === "get-data-dbt-metadata" && reads.dbtError,
  }),
}));
vi.mock("@agent-native/toolkit/design-system", () => ({
  Tooltip: ({
    trigger,
    content,
  }: {
    trigger: ReactNode;
    content: ReactNode;
  }) => (
    <>
      {trigger}
      {content}
    </>
  ),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  reads.dbt = undefined;
  reads.providerDescription = null;
  reads.dbtError = false;
});
async function render(
  metadataTableId = "table:qa:public:orders",
  docsUrl = "https://cloud.getdbt.com/docs/#!/model/model.qa.orders",
  options: {
    providerDescription?: string;
    dbtDescription?: string | null;
    connectionId?: string;
    dbtError?: boolean;
    columns?: boolean;
  } = {},
) {
  reads.providerDescription = options.providerDescription ?? null;
  reads.dbtError = options.dbtError ?? false;
  reads.dbt = {
    connectionId: options.connectionId ?? "qa-connection",
    tableId: metadataTableId,
    metadata: {
      docsUrl,
      description:
        options.dbtDescription === undefined
          ? "Documented orders for analysis"
          : options.dbtDescription,
      columns: [
        {
          name: "id",
          description: "**Stable** order identifier",
          type: "STRING",
        },
      ],
      tests: [
        { name: "id_unique", status: "pass", columnName: "id" },
        { name: "id_present", status: "fail", columnName: "id" },
        { name: "id_valid", status: "error", columnName: "id" },
        { name: "other_column_check", status: "warn", columnName: "other_id" },
        { name: "table_check", status: "error", columnName: null },
      ],
    },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient();
  await act(async () =>
    root?.render(
      <QueryClientProvider client={client}>
        <DataTableDetail
          connectionId="qa-connection"
          connectionName="QA warehouse"
          tableId="table:qa:public:orders"
        />
      </QueryClientProvider>,
    ),
  );
  if (options.columns === false) return;
  const columnsTab = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((b) => b.textContent?.includes("Columns"));
  expect(columnsTab).toBeDefined();
  await act(async () => columnsTab!.click());
}
it("opens a column's documented tests and docs, then returns to the columns", async () => {
  await render();
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "id",
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  const detail = container.querySelector('[aria-label="id details"]');
  expect(detail?.textContent).toContain("Stable order identifier");
  expect(detail?.querySelector("strong")?.textContent).toBe("Stable");
  expect(detail?.textContent).toContain("id_unique");
  expect(detail?.textContent).not.toContain("other_column_check");
  expect(detail?.querySelector("a")?.getAttribute("href")).toBe(
    "https://cloud.getdbt.com/docs/#!/model/model.qa.orders",
  );
  const back = detail?.querySelector<HTMLButtonElement>(
    'button[aria-label="Back"]',
  );
  expect(back).toBeDefined();
  await act(async () => back!.click());
  expect(container.querySelector('[aria-label="id details"]')).toBeNull();
  expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
});

it("keeps unsafe supplemental docs URLs from becoming navigable", async () => {
  await render("table:qa:public:orders", "javascript:alert(1)");
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "id",
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  const detail = container.querySelector('[aria-label="id details"]');
  expect(detail?.textContent).toContain("id_unique");
  expect(detail?.querySelector("a")).toBeNull();
});

it("uses the selected table's dbt description before opening Columns", async () => {
  await render(undefined, undefined, {
    columns: false,
    providerDescription: "Warehouse comment",
  });
  expect(
    container.querySelector(".data-table-detail-description")?.textContent,
  ).toBe("Documented orders for analysis");
});
it("does not show another table's cached dbt description", async () => {
  await render("table:qa:public:other");
  expect(container.querySelector(".data-table-detail-description")).toBeNull();
});

it.each([null, "", "   "])(
  "falls back to the warehouse description for empty dbt text %s",
  async (dbtDescription) => {
    await render(undefined, undefined, {
      dbtDescription,
      providerDescription: "Warehouse comment",
      columns: false,
    });
    expect(
      container.querySelector(".data-table-detail-description")?.textContent,
    ).toBe("Warehouse comment");
  },
);
it("does not display failed metadata or metadata for another connection", async () => {
  await render(undefined, undefined, { connectionId: "other-connection" });
  expect(container.querySelector(".data-table-detail-description")).toBeNull();
});
it("retains the warehouse description when dbt fails", async () => {
  await render(undefined, undefined, {
    dbtError: true,
    providerDescription: "Warehouse comment",
  });
  expect(
    container.querySelector(".data-table-detail-description")?.textContent,
  ).toBe("Warehouse comment");
});

it("renders dbt description formatting without displaying markdown delimiters", async () => {
  await render(undefined, undefined, {
    dbtDescription: "**Documented** orders",
    columns: false,
  });
  const description = container.querySelector(".data-table-detail-description");
  expect(description?.textContent).toBe("Documented orders");
  expect(description?.querySelector("strong")?.textContent).toBe("Documented");
});
