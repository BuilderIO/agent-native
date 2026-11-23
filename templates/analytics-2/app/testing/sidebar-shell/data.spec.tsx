import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";

import {
  DataBrowserPage,
  type DataBrowserPageProps,
} from "../../components/data/DataBrowserPage";
import type {
  DatasetLoader,
  DatasetPage,
  Dataset,
} from "../../components/data/model";
import messages from "../../i18n/en-US";
import {
  init,
  dispose,
  mount,
  capture,
  button,
  click,
  input,
  key,
  settle,
} from "./harness";
const m = vi.hoisted(() => ({
  data: undefined as { allowed: boolean } | undefined,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: m.data,
    isError: m.isError,
    refetch: m.refetch,
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    let v: unknown = messages;
    for (const part of key.split("."))
      v =
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[part]
          : undefined;
    return typeof v === "string" ? v : key;
  },
}));
const connections = [
  {
    id: "connection-a",
    name: "Default connection",
    type: "postgresql",
    isDefault: true,
    description: "Test description",
  },
  {
    id: "connection-b",
    name: "Demo connection",
    type: "postgresql",
    isDemo: true,
  },
  { id: "connection-c", name: "Other connection", type: "postgresql" },
  { id: "connection-hidden", name: "Filtered connection", type: "unavailable" },
];
const schemas = [
  {
    type: "postgresql",
    name: "PostgreSQL",
    supported: true,
    sections: [
      {
        id: "basic",
        group: "Basic" as const,
        fields: [
          { id: "name", label: "Name", type: "text" as const, required: true },
        ],
      },
    ],
  },
];
const page = (
  items: Dataset[] = [],
  hasNextPage = false,
  endCursor: string | null = null,
): DatasetPage => ({ items, hasNextPage, endCursor, totalCount: items.length });
function props(
  overrides: Partial<DataBrowserPageProps> = {},
): DataBrowserPageProps {
  return {
    tab: "all",
    recommendedEnabled: true,
    canViewSemanticLayer: true,
    recommendedPanel: null,
    dataModelsPanel: null,
    recentsPanel: null,
    favoritesPanel: null,
    connections,
    schemas,
    loadPage: async () => page(),
    save: async () => {
      throw new Error("No connection writes in baselines");
    },
    onNavigate: () => {},
    canAddConnection: true,
    refreshAccess: "connection",
    ...overrides,
  } as DataBrowserPageProps;
}
const clients: QueryClient[] = [];
function node(p: DataBrowserPageProps) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <DataBrowserPage {...p} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
function reset() {
  init();
  m.data = { allowed: true };
  m.isError = false;
  m.refetch.mockClear();
}
afterEach(async () => {
  await dispose();
  clients.splice(0).forEach((c) => c.clear());
});
const selectedRows = [
  "sidebar.data",
  "sidebar.data.back",
  "sidebar.data.refresh",
  "sidebar.data.search",
  "sidebar.data.item",
  "sidebar.data.item.expand",
];
function snap(name: string, rows: string[], inputs: Record<string, unknown>) {
  capture(name, rows, { host: "DataBrowserPage", ...inputs });
}
it("captures connection family ordering, filtering, disabled add and list read states", async () => {
  reset();
  const navigate = vi.fn(),
    retry = vi.fn();
  const p = props({ onNavigate: navigate, onRetryConnections: retry });
  const app = await mount(node(p), "/home/data/all");
  snap(
    "data-connections",
    [
      "sidebar.data",
      "sidebar.data.connection.item",
      "sidebar.data.connection.add",
    ],
    { connections, schemas },
  );
  expect(document.querySelectorAll(".data-page-connection-row")).toHaveLength(
    3,
  );
  expect(document.body.textContent).not.toContain("Filtered connection");
  await click(
    document.querySelector(".data-page-connection-row") as HTMLElement,
  );
  expect(navigate).toHaveBeenLastCalledWith({
    tab: "all",
    detail: { type: "data-connection", id: "connection-a" },
  });
  await app.update(node({ ...p, canAddConnection: false }));
  snap(
    "data-connections-no-add",
    ["sidebar.data", "sidebar.data.connection.item"],
    { canAddConnection: false },
  );
  expect(document.querySelector(".data-page-add-connection")).toBeNull();
  for (const state of ["loading", "error"]) {
    await app.update(
      node({ ...p, loading: state === "loading", error: state === "error" }),
    );
    snap(
      `data-connections-${state}`,
      ["sidebar.data", "sidebar.data.connections.status"],
      { state },
    );
  }
  await click(button("Retry"));
  expect(retry).toHaveBeenCalledTimes(1);
});
it("captures the existing connection picker and form with synthetic nonsecret fields", async () => {
  reset();
  await mount(node(props()), "/home/data/all");
  await click(button("Add data connection"));
  snap("data-connection-picker", ["sidebar.data.connection.body"], {
    dialog: "picker",
    schemas,
  });
  const template = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent?.includes("PostgreSQL"));
  expect(template).toBeDefined();
  await click(template as HTMLButtonElement);
  snap("data-connection-form", ["sidebar.data.connection.body"], {
    dialog: "form",
    type: "postgresql",
    values: "empty",
  });
});
it.each(["pending", "denied", "allowed", "error", "refreshing"])(
  "captures authoritative refresh permission %s",
  async (state) => {
    reset();
    m.data =
      state === "pending" || state === "error"
        ? undefined
        : { allowed: state !== "denied" };
    m.isError = state === "error";
    const refresh = vi.fn();
    await mount(
      node(
        props({
          selectedConnectionId: "connection-a",
          onRefreshCatalog: refresh,
          catalogRefreshing: state === "refreshing",
          catalogLastRefreshed: "2026-11-12T07:00:00.000Z",
        }),
      ),
      "/home/data/all/data-connection/connection-a",
    );
    snap(
      `data-refresh-${state}`,
      [
        "sidebar.data",
        "sidebar.data.back",
        "sidebar.data.refresh",
        "sidebar.data.search",
        "sidebar.data.status",
      ],
      { state, access: m.data ?? null, permissionReadError: m.isError },
    );
    expect(button("Refresh schema").disabled).toBe(state !== "allowed");
    if (state === "allowed") {
      await click(button("Refresh schema"));
      expect(refresh).toHaveBeenCalledTimes(1);
    }
    if (state === "error") {
      await click(button("Retry"));
      expect(m.refetch).toHaveBeenCalledTimes(1);
    }
  },
);
it.each(["loading", "error", "empty"])(
  "captures root tree %s and its retry",
  async (state) => {
    reset();
    const loader = vi.fn<DatasetLoader>(() =>
      state === "loading"
        ? new Promise(() => {})
        : state === "error"
          ? Promise.reject(new Error("Synthetic tree failure"))
          : Promise.resolve(page()),
    );
    await mount(
      node(props({ selectedConnectionId: "connection-a", loadPage: loader })),
      "/home/data/all/data-connection/connection-a",
    );
    snap(
      `data-tree-${state}`,
      [
        "sidebar.data",
        "sidebar.data.back",
        "sidebar.data.refresh",
        "sidebar.data.search",
        "sidebar.data.status",
      ],
      { state },
    );
    if (state === "error") {
      const calls = loader.mock.calls.length;
      await click(button("Retry"));
      expect(loader.mock.calls.length).toBeGreaterThan(calls);
    }
  },
);
it("captures recursive tree disclosure, selection, paging failure/retry and missing arrow support", async () => {
  reset();
  let more: "pending" | "error" | "ready" = "pending";
  let resolveMore: ((p: DatasetPage) => void) | undefined;
  const load = vi.fn<DatasetLoader>(async (request) => {
    if (request.after) {
      if (more === "pending")
        return new Promise((resolve) => {
          resolveMore = resolve;
        });
      if (more === "error") throw new Error("Synthetic append failure");
      return page([{ id: "table-b", name: "Second table", kind: "table" }]);
    }
    if (request.parentId === "database-a")
      return page([
        { id: "schema-a", name: "Schema A", kind: "schema", hasChildren: true },
      ]);
    if (request.parentId === "schema-a")
      return page(
        [{ id: "table-a", name: "Table A", kind: "table" }],
        true,
        "cursor-a",
      );
    return page([
      {
        id: "database-a",
        name: "Database A",
        kind: "database",
        hasChildren: true,
      },
    ]);
  });
  const navigate = vi.fn();
  await mount(
    node(
      props({
        selectedConnectionId: "connection-a",
        selectedNodeId: "table-a",
        loadPage: load,
        onNavigate: navigate,
        sourceFamilies: new Map([["connection-a", "databases"]]),
      }),
    ),
    "/home/data/all/table/table-a",
  );
  snap("data-tree-root", selectedRows, {
    sourceFamily: "databases",
    expanded: [],
  });
  await click(button("Collapse Database A"));
  await click(button("Expand Database A"));
  snap("data-tree-database-open", selectedRows, { expanded: ["database-a"] });
  await click(button("Collapse Schema A"));
  await click(button("Expand Schema A"));
  snap("data-tree-schema-open", [...selectedRows, "sidebar.data.more"], {
    expanded: ["database-a", "schema-a"],
    selectedNodeId: "table-a",
  });
  expect(document.querySelectorAll('[role="treeitem"][tabindex]')).toHaveLength(
    0,
  );
  const label = button("Table A");
  label.focus();
  await key(label, "ArrowDown");
  expect(document.activeElement).toBe(label);
  await click(label);
  expect(navigate).toHaveBeenLastCalledWith({
    tab: "all",
    detail: { type: "table", id: "table-a", name: "Table A" },
  });
  await click(button("Load more..."));
  snap("data-tree-append-loading", [...selectedRows, "sidebar.data.status"], {
    append: "pending",
  });
  await act(async () =>
    resolveMore?.(
      page(
        [{ id: "table-b", name: "Second table", kind: "table" }],
        true,
        "cursor-b",
      ),
    ),
  );
  await settle();
  more = "error";
  await click(button("Load more..."));
  snap(
    "data-tree-append-error",
    [...selectedRows, "sidebar.data.status", "sidebar.data.more"],
    { append: "error" },
  );
  more = "ready";
  await click(button("Retry"));
  snap("data-tree-append-retried", selectedRows, { append: "ready" });
  await click(button("Collapse Schema A"));
  snap("data-tree-schema-closed", selectedRows, { expanded: ["database-a"] });
});
it("preserves the 400ms search debounce and resets search on connection change", async () => {
  reset();
  const load = vi.fn<DatasetLoader>(async () => page());
  const p = props({ selectedConnectionId: "connection-a", loadPage: load });
  const app = await mount(node(p), "/home/data/all");
  load.mockClear();
  await input(
    document.querySelector('input[aria-label="Search"]') as HTMLInputElement,
    "needle",
  );
  await act(async () => vi.advanceTimersByTimeAsync(359));
  expect(load.mock.calls.some(([q]) => q.search === "needle")).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(load.mock.calls.some(([q]) => q.search === "needle")).toBe(true);
  snap("data-search-settled", ["sidebar.data.search", "sidebar.data.status"], {
    search: "needle",
    debounceMs: 400,
  });
  await app.update(node({ ...p, selectedConnectionId: "connection-c" }));
  expect(
    (document.querySelector('input[aria-label="Search"]') as HTMLInputElement)
      .value,
  ).toBe("");
  snap("data-search-reset", ["sidebar.data.search", "sidebar.data.status"], {
    connectionId: "connection-c",
    search: "",
  });
});
it.each(["schemas", "databases"] as const)(
  "captures recursive loading/error/empty and root paging for %s",
  async (family) => {
    for (const state of ["loading", "error", "empty"]) {
      reset();
      const parent = {
        id: `${family}-parent`,
        name: "Parent node",
        kind:
          family === "databases" ? ("database" as const) : ("schema" as const),
        hasChildren: true,
      };
      const load = vi.fn<DatasetLoader>((request) =>
        request.parentId
          ? state === "loading"
            ? new Promise(() => {})
            : state === "error"
              ? Promise.reject(new Error("Synthetic child read failure"))
              : Promise.resolve(page())
          : Promise.resolve(page([parent])),
      );
      await mount(
        node(
          props({
            selectedConnectionId: "connection-a",
            loadPage: load,
            sourceFamilies: new Map([["connection-a", family]]),
          }),
        ),
        "/home/data/all",
      );
      await click(button("Collapse Parent node"));
      await click(button("Expand Parent node"));
      snap(
        `data-child-${family}-${state}`,
        [...selectedRows, "sidebar.data.status"],
        { family, state, parentId: parent.id },
      );
      if (state === "error") {
        const calls = load.mock.calls.length;
        await click(button("Retry"));
        expect(load.mock.calls.length).toBeGreaterThan(calls);
      }
      await dispose();
    }
    reset();
    let resolveAppend: ((p: DatasetPage) => void) | undefined;
    let fail = false;
    const load = vi.fn<DatasetLoader>((request) =>
      request.after
        ? fail
          ? Promise.reject(new Error("Synthetic root append failure"))
          : new Promise((resolve) => {
              resolveAppend = resolve;
            })
        : Promise.resolve(
            page(
              [{ id: "leaf-a", name: "Leaf A", kind: "table" }],
              true,
              "root-cursor",
            ),
          ),
    );
    await mount(
      node(
        props({
          selectedConnectionId: "connection-a",
          loadPage: load,
          sourceFamilies: new Map([["connection-a", family]]),
        }),
      ),
      "/home/data/all",
    );
    snap(`data-root-${family}-more`, [...selectedRows, "sidebar.data.more"], {
      family,
      hasNextPage: true,
    });
    await click(button("Load more..."));
    snap(
      `data-root-${family}-append-loading`,
      [...selectedRows, "sidebar.data.status"],
      { family, append: "loading" },
    );
    await act(async () =>
      resolveAppend?.(
        page(
          [{ id: "leaf-b", name: "Leaf B", kind: "table" }],
          true,
          "next-cursor",
        ),
      ),
    );
    await settle();
    fail = true;
    await click(button("Load more..."));
    snap(
      `data-root-${family}-append-error`,
      [...selectedRows, "sidebar.data.status", "sidebar.data.more"],
      { family, append: "error" },
    );
  },
);
