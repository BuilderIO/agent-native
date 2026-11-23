// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { DataTableDetail } from "./DataTableDetail";

const reads = vi.hoisted(() => ({ dbt: undefined as unknown }));
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
    isError: false,
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
});
async function render(metadataTableId = "table:qa:public:orders") {
  reads.dbt = {
    connectionId: "qa-connection",
    tableId: metadataTableId,
    metadata: {
      columns: [
        { name: "id", description: "Stable order identifier", type: "STRING" },
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
  const columnsTab = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((b) => b.textContent?.includes("Columns"));
  expect(columnsTab).toBeDefined();
  await act(async () => columnsTab!.click());
}
it("joins documentation and tests to each column, with error ahead of fail and pass", async () => {
  await render();
  const rows = container.querySelectorAll("tbody tr");
  expect(rows[0]?.textContent).toContain("Stable order identifier");
  expect(
    rows[0]?.querySelector('[data-dbt-column-status="error"]'),
  ).not.toBeNull();
  expect(rows[0]?.textContent).toContain("id_unique");
  expect(rows[0]?.textContent).not.toContain("other_column_check");
  expect(rows[0]?.textContent).not.toContain("table_check");
  expect(
    rows[1]?.querySelector('[data-dbt-column-status="warn"]'),
  ).not.toBeNull();
  expect(rows[1]?.textContent).toContain("other_column_check");
});
it("does not join a previous table's dbt response to the current columns", async () => {
  await render("table:qa:public:previous");
  expect(container.textContent).not.toContain("Stable order identifier");
  expect(container.querySelector("[data-dbt-column-status]")).toBeNull();
  expect(container.textContent).toContain("other_id");
});
