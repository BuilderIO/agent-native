// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
  useDbSync,
} from "./use-db-sync.js";

function SyncProbe({ queryClient }: { queryClient: QueryClient }) {
  useDbSync({
    queryClient: queryClient as never,
    sseUrl: false,
    realtime: { reason: "test resource-scoped action invalidation" },
    interval: 50,
    fallbackInterval: 50,
    pauseWhenHidden: false,
  });
  return null;
}

function cacheActionQuery(
  client: QueryClient,
  actionName: string,
  resources?: string[],
) {
  client.getQueryCache().build(client, {
    queryKey: ["action", actionName, undefined],
    queryFn: async () => null,
    meta: resources ? { actionResources: resources } : undefined,
  });
}

function invalidatedActionNames(client: QueryClient): string[] {
  return client
    .getQueryCache()
    .findAll({ queryKey: ["action"] })
    .filter((query) => query.state.isInvalidated)
    .map((query) => String(query.queryKey[1]))
    .sort();
}

describe("useDbSync action-event invalidation scope", () => {
  let roots: Root[] = [];
  let containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots = [];
    containers = [];
    vi.unstubAllGlobals();
    _resetSyncTransportRegistryForTests();
  });

  async function syncEvents(
    client: QueryClient,
    events: Array<Record<string, unknown>>,
  ) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: 1, events }))),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await act(async () => {
      root.render(<SyncProbe queryClient={client} />);
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
  }

  it("invalidates only the action queries tagged for the changed resource", async () => {
    const client = new QueryClient();
    cacheActionQuery(client, "list-designs", ["design"]);
    cacheActionQuery(client, "list-documents", ["document"]);

    await syncEvents(client, [
      {
        version: 1,
        source: "action",
        type: "change",
        key: "update-design",
        resourceType: "design",
        resourceId: "d1",
      },
    ]);

    expect(invalidatedActionNames(client)).toEqual(["list-designs"]);
  });

  it("invalidates every action query for an action event that names no resource", async () => {
    const client = new QueryClient();
    cacheActionQuery(client, "list-designs", ["design"]);
    cacheActionQuery(client, "list-documents", ["document"]);

    await syncEvents(client, [
      { version: 1, source: "action", type: "change", key: "create-project" },
    ]);

    expect(invalidatedActionNames(client)).toEqual([
      "list-designs",
      "list-documents",
    ]);
  });

  it("invalidates every action query when a batch also carries a non-action change", async () => {
    const client = new QueryClient();
    cacheActionQuery(client, "list-designs", ["design"]);
    cacheActionQuery(client, "list-documents", ["document"]);

    await syncEvents(client, [
      {
        version: 1,
        source: "action",
        type: "change",
        key: "update-design",
        resourceType: "design",
        resourceId: "d1",
      },
      { version: 2, source: "db", type: "change", key: "documents" },
    ]);

    expect(invalidatedActionNames(client)).toEqual([
      "list-designs",
      "list-documents",
    ]);
  });
});
