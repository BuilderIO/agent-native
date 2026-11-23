// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { ProjectDataBrowserPanel } from "./ProjectDataBrowserPanel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "tablePreview.failed": "Could not load the table preview.",
      "editorPreferences.retry": "Retry",
      "tablePreview.loading": "Loading preview...",
      "tablePreview.empty": "This table has no rows.",
      "tablePreview.refresh": "Refresh preview",
      "tablePreview.disabled":
        "Table previews are disabled for this connection.",
      "dataBrowser.missingConnection.back": "Go back",
      "notebook.queryTableAction": "Query",
      "notebook.addingTableQuery": "Adding query…",
      "notebook.tableQueryAdded": "Query added",
      "notebook.addTableQueryFailed": "Couldn’t add the query.",
    })[key] ?? key,
}));

it.each([
  { provider: "BigQuery", tableId: "table:sample:main:orders" },
  {
    provider: "Postgres",
    tableId: "pg-table:sample:main:orders:27",
    providerRevision: "27",
  },
])(
  "opens $provider rows and typed columns, with retry and Query",
  async ({ tableId, providerRevision }) => {
    let previews = 0;
    const queryTable = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("list-connection-datasets"))
          return Response.json({
            items: [
              {
                id: tableId,
                name: "orders",
                kind: "table",
                hasChildren: false,
              },
            ],
            endCursor: null,
            hasNextPage: false,
          });
        if (url.pathname.endsWith("get-data-table-preview")) {
          previews++;
          if (previews === 1)
            return Response.json({ error: "Unavailable" }, { status: 503 });
          return Response.json({
            connectionId: "sample",
            tableId,
            columns: ["amount"],
            rows: [[42]],
          });
        }
        if (url.pathname.endsWith("get-data-table-details"))
          return Response.json({
            connectionId: "sample",
            table: {
              projectId: "sample",
              datasetId: "main",
              tableId: "orders",
              providerRevision,
              columnCount: 1,
              columns: [{ name: "amount", type: "INTEGER" }],
            },
          });
        if (url.pathname.endsWith("get-data-dbt-metadata"))
          return Response.json({
            connectionId: "sample",
            tableId,
            metadata: null,
          });
        throw Error(`Unexpected request ${url.pathname}`);
      }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const flush = async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
    };
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <ProjectDataBrowserPanel
              connections={[{ id: "sample", name: "Sample" }]}
              onClose={() => {}}
              onQuery={queryTable}
            />
          </QueryClientProvider>,
        ),
      );
      await flush();
      const connection = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Data connection"]',
      );
      expect(connection).not.toBeNull();
      await act(async () => {
        connection?.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(host.textContent).toContain("orders");
      const table = [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("orders"),
      );
      expect(table).toBeDefined();
      expect(table?.disabled).toBe(false);
      await act(async () => table?.click());
      await flush();
      const tabs = [
        ...host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ];
      expect(tabs.map((tab) => tab.textContent)).toEqual([
        "Preview",
        "Columns (1)",
      ]);
      const [preview, columns] = tabs;
      expect(preview?.getAttribute("aria-selected")).toBe("true");
      expect(host.textContent).toContain("Could not load the table preview.");
      const retry = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Retry",
      );
      expect(retry).toBeDefined();
      await act(async () => retry?.click());
      await flush();
      expect(host.textContent).toContain("amount");
      expect(
        host.querySelector(".nb-data-browser-preview table td")?.textContent,
      ).toBe("42");
      const refresh = host.querySelector<HTMLButtonElement>(
        '.data-table-detail-actions button[aria-label="Refresh preview"]',
      );
      expect(refresh?.disabled).toBe(false);
      await act(async () => refresh?.click());
      await flush();
      expect(previews).toBe(3);
      await act(async () => columns?.click());
      expect(columns?.getAttribute("aria-selected")).toBe("true");
      expect(host.querySelector('[role="tabpanel"]')?.textContent).toBe(
        "amountINTEGER",
      );
      const query = [
        ...host.querySelectorAll<HTMLButtonElement>(
          ".nb-data-browser-preview button",
        ),
      ].find((button) => button.textContent === "Query");
      expect(query).toBeDefined();
      await act(async () => query?.click());
      expect(queryTable).toHaveBeenCalledWith({
        connectionId: "sample",
        tableId,
      });
      const back = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Go back",
      );
      expect(back).toBeDefined();
      await act(async () => back?.click());
      // oracle-change: the list view now carries the Warehouse and Semantic models section tabs
      expect(
        [...host.querySelectorAll('[role="tab"]')].map(
          (tab) => tab.textContent,
        ),
      ).toEqual([
        "dataBrowser.tabs.warehouse",
        "dataBrowser.notebook.semanticModels",
      ]);
      expect(host.querySelector(".nb-outline-name")?.textContent).toBe(
        "orders",
      );
    } finally {
      act(() => root.unmount());
      client.clear();
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);

it("submits one adopted rail action and retries a lost receipt with the same intent", async () => {
  const connectionId = "sample";
  const tableId = "table:sample:PUBLIC:orders";
  const submissions: unknown[] = [];
  const legacy = vi.fn();
  let failAdmission = () => {};
  const rejectedAdmission = new Promise<Response>((resolve) => {
    failAdmission = () =>
      resolve(Response.json({ error: "Gateway unavailable" }, { status: 503 }));
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("list-connection-datasets"))
        return Response.json({
          items: [
            { id: tableId, name: "orders", kind: "table", hasChildren: false },
          ],
          hasNextPage: false,
          endCursor: null,
        });
      if (url.pathname.endsWith("get-notebook-snapshot"))
        return Response.json({
          status: "accepted",
          snapshot: { head: { versionId: "draft", revision: "1" } },
          resources: { orderRevision: "1" },
          cells: [{ id: "last-cell" }],
        });
      if (url.pathname.endsWith("get-notebook-table-reference"))
        return Response.json({
          connectionId,
          tableId,
          catalogGeneration: "154",
          authorityGeneration: "0",
        });
      if (url.pathname.endsWith("/ui-capability"))
        return Response.json({ ok: true });
      if (url.pathname.endsWith("query-notebook-table")) {
        if (typeof options?.body !== "string")
          throw new Error("Missing action body");
        const body = JSON.parse(options.body);
        submissions.push(body);
        return submissions.length === 1
          ? rejectedAdmission
          : Response.json({ cellId: body.cellId });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find(
      ({ textContent }) => textContent === label,
    );
  const settle = (ready: () => boolean) =>
    vi.waitFor(async () => {
      await act(async () => {});
      if (!ready()) throw new Error("The data browser has not settled");
    });
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/project/notebook/latest/logic"]}>
          <QueryClientProvider client={client}>
            <ProjectDataBrowserPanel
              connections={[{ id: connectionId, name: "Sample" }]}
              onClose={() => {}}
              onQuery={legacy}
            />
          </QueryClientProvider>
        </MemoryRouter>,
      ),
    );
    await settle(() => button("Query") !== undefined);
    const query = button("Query");
    expect(query).toBeDefined();
    await act(async () => {
      query?.click();
      query?.click();
    });
    await settle(
      () => submissions.length > 0 && button("Adding query…") !== undefined,
    );
    expect(submissions).toHaveLength(1);
    const pending = button("Adding query…");
    expect(pending?.disabled).toBe(true);
    await act(async () => pending?.click());
    expect(submissions).toHaveLength(1);
    await act(async () => failAdmission());
    await settle(() => button("Retry") !== undefined);
    const retry = button("Retry");
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    await settle(
      () =>
        host.querySelector('[role="status"]')?.textContent === "Query added",
    );
    expect(legacy).not.toHaveBeenCalled();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0]).toMatchObject({
      projectId: "notebook",
      afterCellId: "last-cell",
      table: {
        connectionId,
        tableId,
        catalogGeneration: "154",
        authorityGeneration: "0",
      },
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Query added",
    );
  } finally {
    act(() => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});
