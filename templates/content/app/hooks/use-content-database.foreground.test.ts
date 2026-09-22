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
