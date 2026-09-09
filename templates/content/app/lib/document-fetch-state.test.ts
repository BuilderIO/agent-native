import { hashKey, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  documentFetchCount,
  subscribeDocumentFetch,
} from "./document-fetch-state";

describe("authoritative document fetches", () => {
  it("advances recovery generation after the same query key is evicted and recreated", async () => {
    const client = new QueryClient();
    const key = ["action", "get-document", { id: "page" }];
    const hash = hashKey(key);
    const cache = client.getQueryCache();
    const unsubscribe = subscribeDocumentFetch(cache, hash, () => {});
    for (let attempt = 0; attempt < 3; attempt++) {
      await client.fetchQuery({
        queryKey: key,
        queryFn: async () => ({ content: `revision ${attempt}` }),
        staleTime: 0,
      });
    }
    const beforeEviction = documentFetchCount(cache, hash);
    client.removeQueries({ queryKey: key, exact: true });
    client.setQueryData(key, { content: "seeded recreation" });
    expect(documentFetchCount(cache, hash)).toBe(0);

    await client.fetchQuery({
      queryKey: key,
      queryFn: async () => ({ content: "authoritative recovery" }),
      staleTime: 0,
    });

    expect(documentFetchCount(cache, hash)).toBeGreaterThan(beforeEviction);
    unsubscribe();
    client.clear();
  });

  it("distinguishes recovery from a cache seed after a failed request", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = ["action", "get-document", { id: "page" }];
    const hash = hashKey(key);
    const cache = client.getQueryCache();
    const unsubscribe = subscribeDocumentFetch(cache, hash, () => {});
    await expect(
      client.fetchQuery({
        queryKey: key,
        queryFn: async () => {
          throw new Error("unavailable");
        },
      }),
    ).rejects.toThrow("unavailable");
    client.setQueryData(key, { content: "stale list snapshot" });
    expect(documentFetchCount(cache, hash)).toBe(0);
    await client.fetchQuery({
      queryKey: key,
      queryFn: async () => ({ content: "restored" }),
    });
    const recovered = documentFetchCount(cache, hash);
    expect(recovered).toBeGreaterThan(0);
    client.setQueryData(key, { content: "another list snapshot" });
    expect(documentFetchCount(cache, hash)).toBe(recovered);
    unsubscribe();
    client.clear();
  });
});
