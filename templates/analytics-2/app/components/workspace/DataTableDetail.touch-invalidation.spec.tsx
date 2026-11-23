// @vitest-environment happy-dom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { DataTableDetail } from "./DataTableDetail";

const reads = vi.hoisted(() => ({
  details: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("./DataFavorites", () => ({ DataTableFavorite: () => null }));
vi.mock("@agent-native/core/client/hooks", async (original) => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...(await original<object>()),
    useActionQuery: (name: string, params: unknown) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn:
          name === "get-data-table-details"
            ? reads.details
            : name === "get-data-dbt-metadata"
              ? async () => ({
                  connectionId: "connection-1",
                  tableId: "table:project:dataset:table",
                  metadata: null,
                })
              : reads.preview,
        initialData:
          name === "get-data-dbt-metadata"
            ? {
                connectionId: "connection-1",
                tableId: "table:project:dataset:table",
                metadata: null,
              }
            : name === "get-data-table-details"
              ? {
                  connectionId: "connection-1",
                  table: {
                    projectId: "project",
                    datasetId: "dataset",
                    tableId: "table",
                    name: "table",
                    columns: [],
                    columnCount: 0,
                  },
                }
              : {
                  connectionId: "connection-1",
                  tableId: "table:project:dataset:table",
                  columns: [],
                  rows: [],
                },
        staleTime: 0,
      }),
  };
});

it("records a table view and refreshes recents without interrupting other reads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finishTouch: (response: Response) => void = () => {
    throw new Error("touch request has not started");
  };
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finishTouch = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const aborted: string[] = [];
  function heldRead(name: string) {
    return ({ signal }: { signal: AbortSignal }) =>
      new Promise(() => {
        signal.addEventListener("abort", () => aborted.push(name));
      });
  }
  reads.details.mockImplementation(heldRead("details"));
  reads.preview.mockImplementation(heldRead("preview"));
  const flags = vi.fn(heldRead("flags"));
  const recents = vi.fn(async () => "updated recents");
  function Observers() {
    useQuery({
      queryKey: ["action", "get-feature-flags"],
      queryFn: flags,
      initialData: "old flags",
      staleTime: 0,
    });
    useQuery({
      queryKey: ["action", "list-data-recents"],
      queryFn: recents,
      initialData: "old recents",
      staleTime: Infinity,
    });
    return null;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Observers />
          <DataTableDetail
            connectionId="connection-1"
            connectionName="Warehouse"
            tableId="table:project:dataset:table"
          />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
      expect(flags).toHaveBeenCalledOnce();
      expect(reads.details).toHaveBeenCalledOnce();
      expect(reads.preview).toHaveBeenCalledOnce();
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/actions/touch-data-recent"),
      expect.objectContaining({
        body: JSON.stringify({
          connectionId: "connection-1",
          tableId: "table:project:dataset:table",
        }),
      }),
    );
    await act(async () =>
      finishTouch(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await vi.waitFor(() => expect(recents).toHaveBeenCalledOnce());
    expect(aborted).toEqual([]);
    expect(flags).toHaveBeenCalledOnce();
    expect(reads.details).toHaveBeenCalledOnce();
    expect(reads.preview).toHaveBeenCalledOnce();
    expect(client.getQueryData(["action", "list-data-recents"])).toBe(
      "updated recents",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});
