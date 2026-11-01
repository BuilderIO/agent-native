// @vitest-environment happy-dom

import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import type {
  ContentDatabaseFilter,
  ContentDatabasePersonalViewOverrides,
  ContentDatabaseSort,
  ContentDatabaseViewConfig,
} from "@shared/api";
import { openingDatabaseTableQuery } from "@shared/database-open-table-query";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; params: unknown }>,
}));

const session = vi.hoisted(() => {
  type Answer = "pending" | "first-read" | "replaced";
  const listeners = new Set<() => void>();
  let answer: Answer = "first-read";
  return {
    transport: {},
    get: () => answer,
    set(next: Answer) {
      answer = next;
      for (const listener of [...listeners]) listener();
    },
    reset(next: Answer) {
      answer = next;
      listeners.clear();
    },
    listeners,
  };
});

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  // Like the session store: a read sent while the load's first session read
  // is out carries its generation, 0, and is current only if that read
  // answers. One sent once it has answered carries the accepted generation.
  sessionReadIdentity: () => ({
    generation: session.get() === "pending" ? 0 : 1,
    transport: session.transport,
  }),
  sessionReadIdentityStatus: (identity: { generation: number }) =>
    identity.generation === 1
      ? "current"
      : session.get() === "pending"
        ? "pending"
        : session.get() === "first-read"
          ? "current"
          : "stale",
  subscribeSessionReadIdentity: (listener: () => void) => {
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  },
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const callAction = (name: string, params: unknown): Promise<unknown> => {
    server.calls.push({ name, params });
    return Promise.resolve({ fetched: name });
  };
  return {
    ...(await importOriginal<
      typeof import("@agent-native/core/client/hooks")
    >()),
    callAction,
    useActionQuery: (name: string, params: unknown, options: object) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: () => callAction(name, params),
        ...options,
      }),
  };
});

import {
  activeDatabaseConstraintCount,
  activeDatabaseView,
  applyPersonalDatabaseViewOverrides,
  normalizeClientDatabaseViewConfig,
  reconcileDatabaseViewSelection,
  requestedDatabaseViewId,
} from "../components/editor/database/DatabaseView";
import { useContentDatabase } from "../hooks/use-content-database";
import {
  addressDatabaseViewId,
  openingDatabaseQueryKey,
  seedPageOpenCollection,
  type PageOpenReadAnswer,
  type PageOpenReadOwner,
} from "./page-open-collection";

// The owner of a page-open read sent as the current session.
function owner(fields: Partial<PageOpenReadOwner> = {}): PageOpenReadOwner {
  return {
    startedAt: Date.now() - 1_000,
    identity: { generation: 1, transport: {} },
    stillOwns: () => true,
    answeredAt: () => {},
    invalidatedWhileOut: () => false,
    finished: () => {},
    ...fields,
  };
}

const deepestFirst: ContentDatabaseSort = {
  key: "depth",
  label: "Depth",
  direction: "desc",
};
const tableQuery = {
  search: "",
  filters: [],
  sorts: [deepestFirst],
  filterMode: "and" as const,
};
const collection: NonNullable<PageOpenReadAnswer["collection"]> = {
  database: { items: [{ id: "row-1" }], properties: [] },
  personalView: { databaseId: "db-1", overrides: null },
  rows: { tableQuery, page: { items: [{ id: "row-1" }], properties: [] } },
};
const personalViewKey = [
  "action",
  "get-content-database-personal-view",
  { databaseId: "db-1" },
];
const rowsKey = [
  "action",
  "query-content-database-items",
  { documentId: "page-1", limit: 100, tableQuery },
];

const reads = (name: string) =>
  server.calls.filter((call) => call.name === name).length;

describe("a collection page's reads in its page-open read", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    server.calls = [];
    session.reset("first-read");
    // The app's own client: a read stays fresh for a while after it lands.
    queryClient = createAgentNativeQueryClient();
  });

  afterEach(() => queryClient.clear());

  it("are where the collection's table looks for them", async () => {
    seedPageOpenCollection(queryClient, "page-1", collection);

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(rowsKey)).toEqual(collection.rows?.page),
    );
    expect(queryClient.getQueryData(openingDatabaseQueryKey("page-1"))).toEqual(
      collection.database,
    );
    expect(queryClient.getQueryData(personalViewKey)).toEqual(
      collection.personalView,
    );
    expect(server.calls).toEqual([]);
  });

  it("are dropped with the page read when another account's session answers", async () => {
    session.reset("pending");
    seedPageOpenCollection(queryClient, "page-1", collection);
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(rowsKey)).toBeDefined(),
    );

    session.set("replaced");

    expect(queryClient.getQueryData(rowsKey)).toBeUndefined();
    expect(
      queryClient.getQueryData(openingDatabaseQueryKey("page-1")),
    ).toBeUndefined();
    expect(queryClient.getQueryData(personalViewKey)).toBeUndefined();
  });

  it("are never seeded once another account's session has answered", () => {
    session.reset("replaced");
    seedPageOpenCollection(queryClient, "page-1", collection, {
      owner: owner({ identity: { generation: 0, transport: {} } }),
    });

    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it("replace a part read before this open's read, such as on an earlier visit", async () => {
    const earlier = Date.now() - 60_000;
    queryClient.setQueryData(
      rowsKey,
      { items: [], stale: 1 },
      {
        updatedAt: earlier,
      },
    );
    queryClient.setQueryData(
      personalViewKey,
      { databaseId: "db-1", stale: 1 },
      { updatedAt: earlier },
    );

    seedPageOpenCollection(queryClient, "page-1", collection, {
      owner: owner(),
    });

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(rowsKey)).toEqual(collection.rows?.page),
    );
    expect(queryClient.getQueryData(personalViewKey)).toEqual(
      collection.personalView,
    );
    expect(server.calls).toEqual([]);
  });

  it("leave a part read since this open's read started to that read", async () => {
    queryClient.setQueryData(personalViewKey, { databaseId: "db-1", own: 1 });
    seedPageOpenCollection(queryClient, "page-1", collection, {
      owner: owner(),
    });

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(rowsKey)).toBeDefined(),
    );
    expect(queryClient.getQueryData(personalViewKey)).toEqual({
      databaseId: "db-1",
      own: 1,
    });
  });

  it("are not seeded once the read's owner is gone", () => {
    seedPageOpenCollection(queryClient, "page-1", collection, {
      owner: owner({ stillOwns: () => false }),
    });

    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  describe("the table that refreshes on every mount", () => {
    let container: HTMLDivElement;
    let root: Root;

    function Table() {
      useContentDatabase("page-1", 100, tableQuery, {
        refetchOnMount: "always",
      });
      return null;
    }

    async function mount() {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Table),
          ),
        );
      });
    }

    beforeEach(() => {
      (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
      ).IS_REACT_ACT_ENVIRONMENT = true;
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
    });

    it("takes this open's read of its rows instead of reading them again", async () => {
      seedPageOpenCollection(queryClient, "page-1", collection);
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(rowsKey)).toBeDefined(),
      );

      await mount();

      expect(reads("get-content-database")).toBe(0);
      expect(reads("query-content-database-items")).toBe(0);
    });

    it("still reads its rows again when this open did not read them", async () => {
      queryClient.setQueryData(openingDatabaseQueryKey("page-1"), {
        items: [],
        properties: [],
      });

      await mount();

      await vi.waitFor(() => expect(reads("get-content-database")).toBe(1));
    });
  });
});

// DatabaseTable's own steps from a saved view, the reader's overrides and the
// address's view to its first rows query.
function tableQueryOfPage(
  viewConfig: Partial<ContentDatabaseViewConfig>,
  overrides: ContentDatabasePersonalViewOverrides | null,
  requestedViewId: string | null,
) {
  const saved = normalizeClientDatabaseViewConfig(viewConfig);
  const { viewConfig: selected } = reconcileDatabaseViewSelection({
    savedViewConfig: saved,
    viewConfig: applyPersonalDatabaseViewOverrides(saved, overrides),
    requestedViewId: requestedDatabaseViewId(null, requestedViewId),
  });
  const view = activeDatabaseView(selected);
  if (
    view.type !== "table" ||
    activeDatabaseConstraintCount("", view.sorts, view.filters) === 0
  ) {
    return undefined;
  }
  return {
    search: "",
    filters: view.filters,
    sorts: view.sorts,
    filterMode: view.filterMode ?? "and",
  };
}

const unfinished: ContentDatabaseFilter = {
  key: "status",
  label: "Status",
  operator: "contains",
  value: "",
};
const emptyNotes: ContentDatabaseFilter = {
  key: "notes",
  label: "Notes",
  operator: "is_empty",
  value: "",
};
const view = (
  id: string,
  type: string,
  values: Record<string, unknown> = {},
) => ({
  id,
  name: id,
  type,
  sorts: [],
  filters: [],
  columnWidths: {},
  ...values,
});
const saved = {
  activeViewId: "table",
  views: [
    view("table", "table", { sorts: [deepestFirst] }),
    view("open", "table", { filters: [emptyNotes], filterMode: "or" }),
    view("draft", "table", { filters: [unfinished] }),
    view("board", "board", { sorts: [deepestFirst] }),
    view("retired", "sidebar", { sorts: [deepestFirst] }),
    view("odd", "table", {
      sorts: [deepestFirst, { key: "x", direction: "sideways" }, null],
    }),
    view(" ", "table", { sorts: [deepestFirst] }),
  ],
};
const overrides = (
  activeViewId: string | undefined,
  views: ContentDatabasePersonalViewOverrides["views"] = [],
): ContentDatabasePersonalViewOverrides => ({
  version: 2,
  ...(activeViewId ? { activeViewId } : {}),
  views,
});

describe("the view a page's address selects", () => {
  it.each([
    ["/page/p?databaseViewId=%20board%20", "board"],
    ["/page/p?viewId=list&databaseViewId=board", "list"],
    ["/page/p?viewId=%20&databaseViewId=board", "board"],
    ["/page/p", null],
  ])("is read from %s as the table reads it", (address, expected) => {
    const search = new URL(address, "https://content.test").search;
    expect(addressDatabaseViewId(search)).toBe(expected);
    expect(addressDatabaseViewId(search)).toBe(
      requestedDatabaseViewId(
        new URLSearchParams(search).get("viewId"),
        new URLSearchParams(search).get("databaseViewId"),
      ),
    );
  });
});

describe("the first rows query of a collection page", () => {
  it.each([
    ["the saved active view", saved, null, null],
    ["an older single-view config", { sorts: [deepestFirst] }, null, null],
    ["a config with no views", {}, null, null],
    [
      "an active view with an unfinished filter",
      { ...saved, activeViewId: "draft" },
      null,
      null,
    ],
    [
      "a view matching any filter",
      { ...saved, activeViewId: "open" },
      null,
      null,
    ],
    ["a board", { ...saved, activeViewId: "board" }, null, null],
    [
      "a retired sidebar view",
      { ...saved, activeViewId: "retired" },
      null,
      null,
    ],
    [
      "a view with malformed sorts",
      { ...saved, activeViewId: "odd" },
      null,
      null,
    ],
    ["the reader's chosen view", saved, overrides("open"), null],
    ["a chosen view that is gone", saved, overrides("deleted"), null],
    [
      "the reader's own sorts",
      saved,
      overrides(undefined, [
        { id: "table", sorts: [], filters: [emptyNotes], filterMode: "and" },
      ]),
      null,
    ],
    ["the view the address names", saved, overrides("open"), "board"],
    ["an address view, padded", saved, null, "  open "],
    ["an address view that is gone", saved, null, "deleted"],
  ] as const)(
    "matches the page for %s",
    (_case, viewConfig, personal, requested) => {
      const expected = tableQueryOfPage(
        viewConfig as Partial<ContentDatabaseViewConfig>,
        personal,
        requested,
      );
      expect(
        openingDatabaseTableQuery({
          viewConfig: viewConfig as Partial<ContentDatabaseViewConfig>,
          overrides: personal,
          requestedViewId: requested,
        }),
      ).toEqual(expected);
    },
  );

  it("ignores overrides of another version", () => {
    expect(
      openingDatabaseTableQuery({
        viewConfig: saved as Partial<ContentDatabaseViewConfig>,
        overrides: { ...overrides("open"), version: 1 },
      }),
    ).toEqual(
      tableQueryOfPage(saved as Partial<ContentDatabaseViewConfig>, null, null),
    );
  });
});
