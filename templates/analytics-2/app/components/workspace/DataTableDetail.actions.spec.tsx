// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callActionMock } = vi.hoisted(() => ({
  callActionMock: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => {
    if (name === "get-data-table-details") {
      return {
        isPending: false,
        isError: false,
        data: {
          connectionId: "conn-1",
          tableId: "table:p:ds:orders",
          table: {
            projectId: "p",
            datasetId: "ds",
            tableId: "orders",
            name: "orders",
            type: "TABLE",
            description: "Customer orders fact table",
            columnCount: 2,
            columns: [
              {
                name: "order_id",
                type: "STRING",
                description: "Primary order identifier",
                columnSemanticLayerType: "DIMENSION",
              },
              {
                name: "amount",
                type: "FLOAT64",
                description: null,
              },
            ],
          },
        },
      };
    }
    if (name === "get-data-dbt-metadata") {
      return {
        isPending: false,
        isError: false,
        data: {
          connectionId: "conn-1",
          tableId: "table:p:ds:orders",
          metadata: null,
        },
      };
    }
    if (name === "get-data-table-preview") {
      return {
        isPending: false,
        isFetching: false,
        isError: false,
        data: {
          connectionId: "conn-1",
          tableId: "table:p:ds:orders",
          columns: ["order_id", "amount"],
          rows: [["o-1", 42]],
        },
        refetch: vi.fn(),
      };
    }
    return { isPending: false, isError: false, data: undefined };
  },
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  callAction: callActionMock,
}));

vi.mock("./DataFavorites", () => ({
  DataTableFavorite: () => <button type="button" aria-label="Favorite" />,
}));

import { DataTableDetail } from "./DataTableDetail";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DataTableDetail header, actions, and columns", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  function render(
    props: Partial<React.ComponentProps<typeof DataTableDetail>> = {},
  ) {
    const client = new QueryClient();
    root = createRoot(host);
    act(() => {
      root!.render(
        <QueryClientProvider client={client}>
          <DataTableDetail
            connectionId="conn-1"
            connectionName="Warehouse"
            tableId="table:p:ds:orders"
            tableName="orders"
            {...props}
          />
        </QueryClientProvider>,
      );
    });
  }

  it("renders breadcrumb, description, and working copy link button in header", async () => {
    render();
    const breadcrumb = host.querySelector('nav[aria-label="Breadcrumb"]');
    expect(breadcrumb?.textContent).toContain("Warehouse");
    expect(breadcrumb?.textContent).toContain("ds");
    expect(host.textContent).toContain("Customer orders fact table");
    const copyBtn = host.querySelector<HTMLButtonElement>(
      'button[data-testid="data-table-copy-link"]',
    );
    expect(copyBtn).not.toBeNull();
    await act(async () => {
      copyBtn?.click();
      await Promise.resolve();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it("renders New thread and Use in project actions when callbacks provided", () => {
    const onNewThread = vi.fn();
    const onUseInProject = vi.fn();
    render({ onNewThread, onUseInProject });
    const newThreadBtn = host.querySelector<HTMLButtonElement>(
      'button[data-testid="data-table-new-thread"]',
    );
    const useBtn = host.querySelector<HTMLButtonElement>(
      'button[data-testid="data-table-use-in-project"]',
    );
    expect(newThreadBtn?.textContent).toMatch(/New thread|Create thread/);
    expect(useBtn?.textContent).toContain("Use in project");
    act(() => {
      newThreadBtn?.click();
      useBtn?.click();
    });
    expect(onNewThread).toHaveBeenCalledTimes(1);
    expect(onUseInProject).toHaveBeenCalledTimes(1);
  });

  it("formats semantic layer column type and shows column descriptions", () => {
    render();
    const columnsTab = [
      ...host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((b) => b.textContent?.includes("Columns"));
    act(() => {
      columnsTab?.click();
    });
    expect(host.textContent).toContain("Primary order identifier");
    expect(host.textContent).toContain("Dimension");
    expect(host.textContent).toContain("FLOAT64");
  });
});
