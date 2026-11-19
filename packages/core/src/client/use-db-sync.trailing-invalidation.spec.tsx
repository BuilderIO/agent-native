// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
  useDbSync,
} from "./use-db-sync.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class QueryClientProbe {
  calls: Array<
    | {
        queryKey?: string[];
        predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
      }
    | undefined
  > = [];
  refetchOptions: Array<{ cancelRefetch?: boolean } | undefined> = [];
  completion = deferred<void>();

  actionQuery = { queryKey: ["action", "read"] };
  appStateQuery = { queryKey: ["app-state", "selection"] };
  queries = [this.actionQuery, this.appStateQuery];

  isFetching(filters?: {
    queryKey?: string[];
    predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
  }) {
    return this.queries.filter(
      (query) =>
        (filters?.queryKey?.every(
          (key, index) => query.queryKey[index] === key,
        ) ??
          true) &&
        (filters?.predicate?.(query) ?? true),
    ).length;
  }

  invalidateQueries(
    filters?: {
      queryKey?: string[];
      predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
    },
    options?: { cancelRefetch?: boolean },
  ) {
    this.calls.push(filters);
    this.refetchOptions.push(options);
    return this.completion.promise;
  }
}

function Probe({ queryClient }: { queryClient: QueryClientProbe }) {
  useDbSync({
    queryClient,
    sseUrl: false,
    realtime: { reason: "test trailing invalidation after remote sync" },
    interval: 100,
    fallbackInterval: 100,
    pauseWhenHidden: false,
  });
  return null;
}

describe("useDbSync trailing invalidation", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    _resetSyncTransportRegistryForTests();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    _resetSyncTransportRegistryForTests();
  });

  it("attaches one trailing refresh while repeated batches overlap the same fetch", async () => {
    const queryClient = new QueryClientProbe();
    let poll = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        poll += 1;
        const version = poll === 2 ? 1 : poll === 5 ? 2 : 0;
        const events =
          poll === 2 || poll === 5 ? [{ version, source: "action" }] : [];
        return new Response(JSON.stringify({ version, events }));
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe queryClient={queryClient} />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });

    expect(queryClient.refetchOptions).toEqual([
      { cancelRefetch: false },
      { cancelRefetch: false },
    ]);

    queryClient.completion.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    expect(queryClient.refetchOptions).toEqual([
      { cancelRefetch: false },
      { cancelRefetch: false },
      undefined,
    ]);
  });

  it("does not run a trailing refresh after teardown", async () => {
    const queryClient = new QueryClientProbe();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 1,
              events: [{ version: 1, source: "action" }],
            }),
          ),
      ),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe queryClient={queryClient} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    expect(queryClient.refetchOptions).toEqual([{ cancelRefetch: false }]);

    act(() => root?.unmount());
    queryClient.completion.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    expect(queryClient.refetchOptions).toEqual([{ cancelRefetch: false }]);
  });

  it("dedupes trailing refreshes for freshly-created app-state predicates", async () => {
    const queryClient = new QueryClientProbe();
    let poll = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        poll += 1;
        const version = poll === 2 ? 1 : poll === 5 ? 2 : 0;
        const events =
          poll === 2 || poll === 5
            ? [{ version, source: "app-state", key: "selection" }]
            : [];
        return new Response(JSON.stringify({ version, events }));
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe queryClient={queryClient} />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });

    const predicateFilters = queryClient.calls.filter(
      (filters) => filters?.predicate,
    );
    expect(predicateFilters).toHaveLength(2);
    // oracle-change: query identities dedupe trailing work; the predicate's selection scope stays observable.
    expect(
      predicateFilters.map((filters) => [
        filters?.predicate?.(queryClient.appStateQuery),
        filters?.predicate?.({ queryKey: ["app-state", "other"] }),
        filters?.predicate?.(queryClient.actionQuery),
      ]),
    ).toEqual([
      [true, false, false],
      [true, false, false],
    ]);
    expect(queryClient.refetchOptions).toEqual([
      { cancelRefetch: false },
      { cancelRefetch: false },
    ]);

    queryClient.completion.resolve();
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryClient.refetchOptions).toEqual([
      { cancelRefetch: false },
      { cancelRefetch: false },
      undefined,
    ]);
    expect(
      queryClient.calls
        .filter((filters) => filters?.predicate)
        .map((filters) => [
          filters?.predicate?.(queryClient.appStateQuery),
          filters?.predicate?.({ queryKey: ["app-state", "other"] }),
          filters?.predicate?.(queryClient.actionQuery),
        ]),
    ).toEqual([
      [true, false, false],
      [true, false, false],
      [true, false, false],
    ]);
  });
});
