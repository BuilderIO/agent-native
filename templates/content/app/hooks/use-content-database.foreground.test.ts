import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionQuery = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery,
  useActionMutation: vi.fn(),
  callAction: vi.fn(),
}));
vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual("@tanstack/react-query")),
  useQueryClient,
}));

import type { ContentDatabaseTableQuery } from "@shared/api";

import { useContentDatabase } from "./use-content-database";

describe("foreground database read after cached creation", () => {
  beforeEach(() => {
    useActionQuery.mockReset();
    useActionQuery.mockReturnValue({ data: undefined });
  });

  function observe(refetchOnMount?: "always", reject = false) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    useQueryClient.mockReturnValue(client);
    const queryKey = [
      "action",
      "get-content-database",
      { documentId: "database-page", limit: 100 },
    ];
    const data = { database: { id: "database" }, items: [] };
    client.setQueryData(queryKey, data);
    function Probe() {
      useContentDatabase(
        "database-page",
        100,
        undefined,
        refetchOnMount ? { refetchOnMount } : undefined,
      );
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const options = useActionQuery.mock.calls.find(
      ([name]) => name === "get-content-database",
    )![2];
    const fetch = vi.fn(async () => {
      if (reject) throw new Error("Access denied");
      return data;
    });
    const observer = new QueryObserver(client, {
      ...options,
      queryKey,
      queryFn: fetch,
    });
    const unsubscribe = observer.subscribe(() => {});
    return { client, observer, fetch, unsubscribe };
  }

  it("performs the authoritative read needed to record an already-cached foreground View", async () => {
    const { client, observer, fetch, unsubscribe } = observe("always");
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isFetchedAfterMount).toBe(true),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(observer.getCurrentResult().isSuccess).toBe(true);
    unsubscribe();
    client.clear();
  });

  it("does not force an extra read for a fresh embedded database", () => {
    const { client, observer, fetch, unsubscribe } = observe();
    expect(fetch).not.toHaveBeenCalled();
    expect(observer.getCurrentResult().isFetchedAfterMount).toBe(false);
    unsubscribe();
    client.clear();
  });

  it("does not admit cached data as a successful visit when revalidation fails", async () => {
    const { client, observer, unsubscribe } = observe("always", true);
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isError).toBe(true),
    );
    expect(observer.getCurrentResult().isSuccess).toBe(false);
    unsubscribe();
    client.clear();
  });
});

describe("rows for the requested view", () => {
  const baseData = {
    database: { id: "database" },
    items: [{ id: "stored-first" }],
  };
  const tableQuery: ContentDatabaseTableQuery = {
    search: "",
    filters: [],
    sorts: [{ key: "rank", label: "Rank", direction: "asc" }],
    filterMode: "and",
  };

  function read(
    base: { data?: unknown; isError?: boolean },
    page: { data?: unknown; isError?: boolean },
  ) {
    useQueryClient.mockReturnValue(new QueryClient());
    useActionQuery.mockImplementation((name: string) =>
      name === "get-content-database"
        ? { isError: false, ...base }
        : { isError: false, ...page },
    );
    let result: ReturnType<typeof useContentDatabase> | undefined;
    function Probe() {
      result = useContentDatabase("database-page", 100, tableQuery);
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    return result!;
  }

  it("reports a failed sorted read as failed, not as the base rows", () => {
    const result = read({ data: baseData }, { isError: true });
    expect(result.itemsSettled).toBe(true);
    expect(result.itemsFailed).toBe(true);
  });

  it("reports a failed base read as failed, not as an empty view", () => {
    const result = read({ isError: true }, { data: undefined });
    expect(result.itemsSettled).toBe(true);
    expect(result.itemsFailed).toBe(true);
  });

  it("draws the sorted rows once they land", () => {
    const result = read(
      { data: baseData },
      { data: { items: [{ id: "rank-first" }] } },
    );
    expect(result.itemsFailed).toBe(false);
    expect(result.data?.items).toEqual([{ id: "rank-first" }]);
  });
});
