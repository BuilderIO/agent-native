import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

interface Designs {
  designs: Array<{ title: string }>;
}

function storageWith(scope: string, initial: PersistedClient) {
  const records = new Map([[scope, initial]]);
  return {
    records,
    storage: {
      get: async (key: string) => records.get(key),
      set: async (key: string, value: PersistedClient) => {
        records.set(key, value);
      },
      del: async (key: string) => {
        records.delete(key);
      },
      keys: async () => [...records.keys()],
      clear: async () => records.clear(),
    },
  };
}

it("continues persistence only for eligible queries from an accepted cold restore", async () => {
  const sourceAction = await import("./use-action.js");
  const scope = `private-cold-restore-${crypto.randomUUID()}`;
  const queryKey = ["action", "list-designs", undefined, scope] as const;
  const sourceClient = new QueryClient();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ designs: [{ title: "allowed" }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Native-Browser-Persist": "allow",
          },
        }),
    ),
  );

  let renderedTitle: string | undefined;
  function QueryView() {
    const query = sourceAction.useActionQuery<Designs>(
      "list-designs" as never,
      undefined,
      { queryKeyScope: [scope], retry: false },
    );
    renderedTitle = query.data?.designs[0]?.title;
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={sourceClient}>
        <QueryView />
      </QueryClientProvider>,
    );
  });
  await expect.poll(() => renderedTitle).toBe("allowed");

  const sourceQuery = sourceClient.getQueryCache().find({ queryKey });
  expect(sourceQuery).toBeDefined();
  expect(sourceAction.isBrowserPersistableActionQuery(sourceQuery!)).toBe(true);
  const queryHash = sourceQuery!.queryHash;
  const persisted: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(sourceClient, {
      shouldDehydrateQuery: sourceAction.isBrowserPersistableActionQuery,
      shouldDehydrateMutation: () => false,
    }),
  };
  expect(
    persisted.clientState.queries.map((query) => query.queryHash),
  ).toContain(queryHash);
  await act(async () => root.unmount());
  container.remove();

  const candidateAction = await import("./use-action.js");
  const candidateCache = await import("./action-query-cache.js");
  const restoredClient = new QueryClient();
  const { records, storage } = storageWith(scope, persisted);
  candidateCache.setActionQueryCacheStorage(storage);
  await candidateCache.bindActionQueryCache(restoredClient, scope);

  const restored = restoredClient.getQueryCache().find({ queryKey });
  expect(restored?.state.status).toBe("success");
  expect(restored?.state.dataUpdatedAt).toBe(sourceQuery!.state.dataUpdatedAt);
  expect(candidateAction.isBrowserPersistableActionQuery(restored!)).toBe(true);

  restoredClient.setQueryData(["action", "write-trigger", scope], { ok: true });
  await expect
    .poll(() => records.get(scope)?.timestamp, {
      timeout: 3_000,
      interval: 25,
    })
    .toBeGreaterThan(persisted.timestamp);
  expect(
    records.get(scope)?.clientState.queries.map((query) => query.queryHash),
  ).toContain(queryHash);
  vi.unstubAllGlobals();
});
