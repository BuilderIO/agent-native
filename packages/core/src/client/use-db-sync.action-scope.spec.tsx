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

  it.each([
    {
      name: "an exact record, including colons in its ID",
      events: [{ resourceType: "design", resourceId: "d1:part" }],
      expected: ["design-d1-part", "design-list", "untagged"],
    },
    {
      name: "a known type without an ID",
      events: [{ resourceType: "design" }],
      expected: [
        "design-d1",
        "design-d1-part",
        "design-d2",
        "design-list",
        "untagged",
      ],
    },
    {
      name: "a known type with an empty ID",
      events: [{ resourceType: "design", resourceId: "" }],
      expected: [
        "design-d1",
        "design-d1-part",
        "design-d2",
        "design-list",
        "untagged",
      ],
    },
    {
      name: "a batch of exact records from different types",
      events: [
        { resourceType: "design", resourceId: "d1" },
        { resourceType: "document", resourceId: "doc1" },
      ],
      expected: [
        "design-d1",
        "design-list",
        "document-doc1",
        "document-list",
        "untagged",
      ],
    },
    {
      name: "a batch with a type-wide change and an exact record",
      events: [
        { resourceType: "design" },
        { resourceType: "document", resourceId: "doc1" },
      ],
      expected: [
        "design-d1",
        "design-d1-part",
        "design-d2",
        "design-list",
        "document-doc1",
        "document-list",
        "untagged",
      ],
    },
    {
      name: "a batch with an unscoped action event",
      events: [{ resourceType: "design", resourceId: "d1" }, {}],
      expected: [
        "design-d1",
        "design-d1-part",
        "design-d2",
        "design-list",
        "document-doc1",
        "document-list",
        "untagged",
      ],
    },
  ])("scopes $name", async ({ events, expected }) => {
    const client = new QueryClient();
    cacheActionQuery(client, "design-list", ["design"]);
    cacheActionQuery(client, "design-d1", ["design:d1"]);
    cacheActionQuery(client, "design-d1-part", ["design:d1:part"]);
    cacheActionQuery(client, "design-d2", ["design:d2"]);
    cacheActionQuery(client, "document-list", ["document"]);
    cacheActionQuery(client, "document-doc1", ["document:doc1"]);
    cacheActionQuery(client, "untagged");
    const nonAction = client.getQueryCache().build(client, {
      queryKey: ["other", "design"],
      queryFn: async () => null,
      meta: { actionResources: ["design:d1"] },
    });

    await syncEvents(
      client,
      events.map((event, index) => ({
        version: index + 1,
        source: "action",
        type: "change",
        key: "update-record",
        ...event,
      })),
    );

    expect(invalidatedActionNames(client)).toEqual(expected);
    expect(nonAction.state.isInvalidated).toBe(false);
  });

  it.each([
    {
      name: "an exact ID",
      resourceId: "a:b",
      expected: ["layer-a-b", "layer-list", "untagged"],
    },
    {
      name: "a missing ID",
      resourceId: undefined,
      expected: [
        "layer-a",
        "layer-a-b",
        "layer-list",
        "layer-other",
        "untagged",
      ],
    },
  ])(
    "matches a colon-containing event type with $name",
    async ({ resourceId, expected }) => {
      const client = new QueryClient();
      cacheActionQuery(client, "design-list", ["design"]);
      cacheActionQuery(client, "layer-list", ["design:layer"]);
      cacheActionQuery(client, "layer-a", ["design:layer:a"]);
      cacheActionQuery(client, "layer-a-b", ["design:layer:a:b"]);
      cacheActionQuery(client, "layer-other", ["design:layer:other"]);
      cacheActionQuery(client, "document", ["document"]);
      cacheActionQuery(client, "untagged");

      await syncEvents(client, [
        {
          version: 1,
          source: "action",
          type: "change",
          key: "update-layer",
          resourceType: "design:layer",
          resourceId,
        },
      ]);

      expect(invalidatedActionNames(client)).toEqual(expected);
    },
  );

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
    cacheActionQuery(client, "list-designs", ["design:d2"]);
    cacheActionQuery(client, "list-documents", ["document:doc1"]);

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
