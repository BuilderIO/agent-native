// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ProjectDataBrowserPanel } from "./ProjectDataBrowserPanel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(props: {
  importedConnectionIds?: ReadonlySet<string>;
  onImport?: (connectionId: string) => Promise<void> | void;
  onQueryConnection?: (
    connectionId: string,
    source: string | null,
  ) => Promise<void>;
  onQuery?: (table: { connectionId: string; tableId: string }) => void;
  items?: Array<{
    id: string;
    name: string;
    kind: "database" | "schema" | "table";
    hasChildren: boolean;
  }>;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("get-data-table-preview")) {
        return Response.json({
          connectionId: "one",
          tableId: url.searchParams.get("tableId"),
          columns: ["amount"],
          rows: [[42]],
        });
      }
      return Response.json({
        items: props.items ?? [
          {
            id: "table:proj:sales:orders",
            name: "orders",
            kind: "table",
            hasChildren: false,
          },
        ],
        endCursor: null,
        hasNextPage: false,
      });
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectDataBrowserPanel
          connections={[{ id: "one", name: "One" }]}
          onClose={onClose}
          {...props}
        />
      </QueryClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    client.clear();
    host.remove();
  };
  return { onClose };
}

const button = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === label,
  );
async function until(check: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      check();
    },
    { timeout: 4000, interval: 50 },
  );
}

it("report QA-1795062781: a connection that is not in the notebook offers Import", async () => {
  const onImport = vi.fn();
  mount({
    importedConnectionIds: new Set(),
    onImport,
    onQueryConnection: vi.fn(),
  });
  await until(() => expect(button("Import")).toBeDefined());
  await act(async () => button("Import")?.click());
  expect(onImport).toHaveBeenCalledWith("one");
});

it("report QA-1795062781: an imported connection offers Query and no Import", async () => {
  const onQuery = vi.fn(async () => {});
  const { onClose } = mount({
    importedConnectionIds: new Set(["one"]),
    onImport: vi.fn(),
    onQueryConnection: onQuery,
  });
  await until(() => expect(button("Query")).toBeDefined());
  expect(button("Import")).toBeUndefined();
  await act(async () => button("Query")?.click());
  expect(onQuery).toHaveBeenCalledWith("one", null);
  await until(() => expect(onClose).toHaveBeenCalled());
});

it("report QA-1795062781: a table's Query action starts a SELECT on it", async () => {
  const onQueryConnection = vi.fn(async () => {});
  const onQuery = vi.fn();
  mount({
    importedConnectionIds: new Set(["one"]),
    onImport: vi.fn(),
    onQueryConnection,
    onQuery,
  });
  await until(() =>
    expect(document.querySelector(".nb-outline-name")).not.toBeNull(),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".nb-outline-item")?.click(),
  );
  await until(() =>
    expect(document.querySelectorAll("button").length).toBeGreaterThan(0),
  );
  const queries = [...document.querySelectorAll("button")].filter(
    (el) => el.textContent?.trim() === "Query",
  );
  // oracle-change: the side panel's table preview replaces the connection list, so only the table's Query shows
  expect(queries).toHaveLength(1);
  await act(async () => queries[0]?.click());
  // oracle-change: a table Query admits the server-qualified table query instead of passing client-built SELECT text
  expect(onQuery).toHaveBeenCalledWith({
    connectionId: "one",
    tableId: "table:proj:sales:orders",
  });
  expect(onQueryConnection).not.toHaveBeenCalled();
});

it("report QA-1795062781: database resources in the tree offer Import and Query actions", async () => {
  const onImport = vi.fn();
  const onQueryConnection = vi.fn(async () => {});
  const { onClose } = mount({
    importedConnectionIds: new Set(),
    onImport,
    onQueryConnection,
    items: [
      {
        id: "db:one:sales_dw",
        name: "sales_dw",
        kind: "database",
        hasChildren: true,
      },
    ],
  });
  await until(() =>
    expect(document.querySelector(".nb-outline-name")?.textContent).toBe(
      "sales_dw",
    ),
  );
  const importButtons = [...document.querySelectorAll("button")].filter(
    (el) => el.textContent?.trim() === "Import",
  );
  expect(importButtons.length).toBeGreaterThanOrEqual(2);
  const queryButtons = [...document.querySelectorAll("button")].filter(
    (el) => el.textContent?.trim() === "Query",
  );
  expect(queryButtons.length).toBeGreaterThanOrEqual(2);
  await act(async () => queryButtons[1]?.click());
  expect(onQueryConnection).toHaveBeenCalledWith("one", null);
  await until(() => expect(onClose).toHaveBeenCalled());
});

it("report QA-1795062781: clicking Import on a tree database resource imports it", async () => {
  const onImport = vi.fn();
  const onQueryConnection = vi.fn(async () => {});
  const { onClose } = mount({
    importedConnectionIds: new Set(),
    onImport,
    onQueryConnection,
    items: [
      {
        id: "db:one:sales_dw",
        name: "sales_dw",
        kind: "database",
        hasChildren: true,
      },
    ],
  });
  await until(() =>
    expect(document.querySelector(".nb-outline-name")?.textContent).toBe(
      "sales_dw",
    ),
  );
  const importButtons = [...document.querySelectorAll("button")].filter(
    (el) => el.textContent?.trim() === "Import",
  );
  await act(async () => importButtons[1]?.click());
  expect(onImport).toHaveBeenCalledWith("one");
  await until(() => expect(onClose).toHaveBeenCalled());
});
