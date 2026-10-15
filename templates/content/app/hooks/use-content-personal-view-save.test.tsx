// @vitest-environment happy-dom

import {
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
  type ContentDatabasePersonalViewOverrides,
} from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUpdateContentDatabasePersonalView } from "./use-content-database";
import { useUpdateContentPersonalNavigation } from "./use-content-personal-navigation";

const FILES = "files-db";
const OTHER_FILES = "files-db-2";

function tree(databaseId: string): QueryKey {
  return [
    "action",
    "query-content-database-items",
    { databaseId, limit: 20, navigation: { parentId: null } },
  ];
}

function personalView(databaseId: string): QueryKey {
  return ["action", "get-content-database-personal-view", { databaseId }];
}

function overrides(activeViewId: string): ContentDatabasePersonalViewOverrides {
  return {
    version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
    activeViewId,
    views: [{ id: activeViewId, sorts: [], filters: [], filterMode: "and" }],
  };
}

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root;
let unsubscribes: Array<() => void>;
let pendingSaves: Array<{
  request: Record<string, unknown>;
  answer: (body: unknown) => void;
}>;

/** Mounts a read as an active observer and returns its fetch counter. */
async function mountRead(queryKey: QueryKey, read: () => unknown) {
  const queryFn = vi.fn(async () => structuredClone(read()));
  queryClient.setQueryData(queryKey, read());
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn,
    staleTime: Infinity,
    retry: false,
  });
  unsubscribes.push(observer.subscribe(() => {}));
  return queryFn;
}

async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => {
    expect(queryClient.isMutating()).toBe(0);
    expect(queryClient.isFetching()).toBe(0);
  });
}

async function renderHook<T>(hook: () => T) {
  const result: { current: T | null } = { current: null };
  function Harness() {
    result.current = hook();
    return null;
  }
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  await act(async () =>
    root.render(
      <Providers>
        <Harness />
      </Providers>,
    ),
  );
  return result as { current: T };
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  unsubscribes = [];
  pendingSaves = [];
  // Each save stays in flight until the test answers it.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: { body?: string }) =>
        new Promise<Response>((resolve) => {
          pendingSaves.push({
            request: JSON.parse(init?.body ?? "{}"),
            answer: (body) =>
              resolve(
                new Response(JSON.stringify(body), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
              ),
          });
        }),
    ),
  );
});

afterEach(async () => {
  unsubscribes.forEach((unsubscribe) => unsubscribe());
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("personal view saves", () => {
  it("re-read the Files tree once a view switch from the database view settles", async () => {
    const treeRead = await mountRead(tree(FILES), () => ({ items: [] }));
    let storedView: unknown = {
      databaseId: FILES,
      overrides: overrides("table"),
    };
    await mountRead(personalView(FILES), () => storedView);
    const hooks = await renderHook(() =>
      useUpdateContentPersonalNavigation(FILES),
    );

    await act(async () => {
      hooks.current.mutate({
        databaseId: FILES,
        navigation: { activeViewId: "board" },
      });
    });
    await vi.waitFor(() => expect(pendingSaves).toHaveLength(1));
    // A read now could still see the view from before the save.
    expect(treeRead).not.toHaveBeenCalled();

    // The save answers with the view it already shows, so the cached view
    // keeps its identity; the tree still reads again.
    const shown = queryClient.getQueryData(personalView(FILES));
    expect(shown).toMatchObject({ overrides: { activeViewId: "board" } });
    storedView = shown;
    await act(async () => pendingSaves[0]!.answer(shown));
    await settled();

    expect(queryClient.getQueryData(personalView(FILES))).toBe(shown);
    expect(treeRead).toHaveBeenCalledTimes(1);
  });

  it("wait for every save of the same view before re-reading the tree", async () => {
    const treeRead = await mountRead(tree(FILES), () => ({ items: [] }));
    const otherTreeRead = await mountRead(tree(OTHER_FILES), () => ({
      items: [],
    }));
    await mountRead(personalView(FILES), () => ({
      databaseId: FILES,
      overrides: overrides("board"),
    }));
    const hooks = await renderHook(() => ({
      sidebar: useUpdateContentDatabasePersonalView(FILES),
      databaseView: useUpdateContentPersonalNavigation(FILES),
    }));

    await act(async () => {
      hooks.current.sidebar.mutate({
        databaseId: FILES,
        overrides: overrides("list"),
      });
      hooks.current.databaseView.mutate({
        databaseId: FILES,
        navigation: { activeViewId: "board" },
      });
    });
    await vi.waitFor(() => expect(pendingSaves).toHaveLength(2));
    const save = (kind: "overrides" | "navigation") =>
      pendingSaves.find(({ request }) => kind in request)!;

    await act(async () =>
      save("overrides").answer({
        databaseId: FILES,
        overrides: overrides("list"),
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(queryClient.isMutating()).toBe(1);
    expect(treeRead).not.toHaveBeenCalled();

    await act(async () =>
      save("navigation").answer({
        databaseId: FILES,
        overrides: overrides("board"),
      }),
    );
    await settled();

    expect(treeRead).toHaveBeenCalledTimes(1);
    expect(otherTreeRead).not.toHaveBeenCalled();
  });
});
