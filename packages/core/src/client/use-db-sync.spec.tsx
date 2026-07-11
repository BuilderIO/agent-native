// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBrowserTabId } from "./browser-tab-id.js";
import {
  isInteractionCriticalSyncEvent,
  subscribeSyncEvents,
  useDbSync,
  useScreenRefreshKey,
  _resetSyncTransportRegistryForTests,
  type SyncEvent,
} from "./use-db-sync.js";

class QueryClientProbe {
  queries = [
    { queryKey: ["sql-chart", "panel-1"] },
    { queryKey: ["sql-dashboards-sidebar"] },
  ];
  calls: Array<
    | {
        queryKey?: string[];
        predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
      }
    | undefined
  > = [];
  refetchOptions: Array<{ cancelRefetch?: boolean } | undefined> = [];

  invalidateQueries(
    opts?: {
      queryKey?: string[];
      predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
    },
    options?: { cancelRefetch?: boolean },
  ) {
    this.calls.push(opts);
    this.refetchOptions.push(options);
  }
}

function SyncProbe({
  queryClient,
  actionInvalidatePredicate,
  suppressActionInvalidationFor,
  onEvent,
}: {
  queryClient: QueryClientProbe;
  actionInvalidatePredicate?: (query: {
    queryKey: readonly unknown[];
  }) => boolean;
  suppressActionInvalidationFor?: string[];
  onEvent?: (data: any) => void;
}) {
  useDbSync({
    queryClient,
    sseUrl: false,
    interval: 50,
    pauseWhenHidden: false,
    actionInvalidatePredicate,
    suppressActionInvalidationFor,
    onEvent,
  });
  return null;
}

let screenKeyValue = 0;
function ScreenKeyProbe() {
  const k = useScreenRefreshKey({
    sseUrl: false,
    interval: 50,
    pauseWhenHidden: false,
  });
  screenKeyValue = k;
  return null;
}

async function renderWithEvent(event: Record<string, unknown>) {
  const queryClient = new QueryClientProbe();
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ version: event.version ?? 1, events: [event] }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SyncProbe queryClient={queryClient} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  // useDbSync coalesces invalidation into a single flush per
  // INVALIDATE_COALESCE_MS (250ms) — wait past that window (outside `act`,
  // since a raw application `setTimeout` nested inside `act(async () => …)`
  // is not reliably awaited by React's act() batching) so the batch has
  // landed before assertions run.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });

  return { container, fetchMock, queryClient, root };
}

function resultlessActionInvalidations(
  calls: QueryClientProbe["calls"],
): QueryClientProbe["calls"] {
  return calls.filter(
    (call) => call === undefined || call?.queryKey?.[0] === "action",
  );
}

describe("useDbSync", () => {
  let roots: Root[] = [];
  let containers: HTMLDivElement[] = [];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    _resetSyncTransportRegistryForTests();
    screenKeyValue = 0;
  });

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount());
    }
    for (const container of containers) {
      container.remove();
    }
    roots = [];
    containers = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
    _resetSyncTransportRegistryForTests();
  });

  it("invalidates only action-backed queries by default for action events", async () => {
    const result = await renderWithEvent({
      version: 1,
      source: "action",
      type: "change",
      key: "create-project",
    });
    roots.push(result.root);
    containers.push(result.container);

    expect(result.fetchMock).toHaveBeenCalled();
    expect(result.queryClient.calls).toEqual([{ queryKey: ["action"] }]);
    expect(result.queryClient.refetchOptions).toEqual([
      { cancelRefetch: false },
    ]);
  });

  it("does not refetch for an action event echoed back to its originating tab", async () => {
    const result = await renderWithEvent({
      version: 1,
      source: "action",
      type: "change",
      key: "create-project",
      requestSource: getBrowserTabId(),
    });
    roots.push(result.root);
    containers.push(result.container);

    expect(result.fetchMock).toHaveBeenCalled();
    expect(result.queryClient.calls).toEqual([]);
  });

  it("still processes same-tab domain events that do not have a local cache update", async () => {
    const result = await renderWithEvent({
      version: 1,
      source: "app-state",
      type: "change",
      key: "navigate",
      requestSource: getBrowserTabId(),
    });
    roots.push(result.root);
    containers.push(result.container);

    expect(result.queryClient.calls).toContainEqual({
      queryKey: ["app-state"],
    });
    expect(result.queryClient.calls).toContainEqual({
      queryKey: ["navigate-command"],
    });
  });

  it("can scope the broad action invalidate away from expensive query keys", async () => {
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [{ version: 1, source: "action", type: "change" }],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(
        <SyncProbe
          queryClient={queryClient}
          actionInvalidatePredicate={(query) =>
            query.queryKey[0] !== "sql-chart"
          }
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // useDbSync coalesces invalidation into a single flush per
    // INVALIDATE_COALESCE_MS (250ms); wait past that window outside `act`
    // (see the comment in renderWithEvent above).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    const broadCall = queryClient.calls.find((call) => call?.predicate);
    expect(broadCall?.predicate?.(queryClient.queries[0])).toBe(false);
    expect(broadCall?.predicate?.(queryClient.queries[1])).toBe(true);
    expect(queryClient.calls).toEqual([broadCall]);
    expect(queryClient.refetchOptions).toEqual([{ cancelRefetch: false }]);
  });

  it("can suppress action-query invalidation for high-volume background actions", async () => {
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [
              {
                version: 1,
                source: "action",
                type: "change",
                key: "process-builder-body-hydration",
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    const forwardedEvents: any[] = [];
    await act(async () => {
      root.render(
        <SyncProbe
          queryClient={queryClient}
          suppressActionInvalidationFor={["process-builder-body-hydration"]}
          onEvent={(evt) => forwardedEvents.push(evt)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // useDbSync coalesces invalidation into a single flush per
    // INVALIDATE_COALESCE_MS (250ms); wait past that window outside `act`
    // (see the comment in renderWithEvent above).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    expect(resultlessActionInvalidations(queryClient.calls)).toHaveLength(0);
    expect(queryClient.calls).not.toContainEqual({ queryKey: ["extension"] });
    expect(queryClient.calls).not.toContainEqual({ queryKey: ["extensions"] });
    expect(queryClient.calls).not.toContainEqual({
      queryKey: ["slot-installs"],
    });
    // Suppression must not swallow the events themselves — templates layer
    // surgical logic on onEvent and must still see suppressed-action batches.
    expect(forwardedEvents).toContainEqual(
      expect.objectContaining({ key: "process-builder-body-hydration" }),
    );
  });

  it("refreshes framework prefixes for mixed action batches", async () => {
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [
              {
                version: 1,
                source: "action",
                type: "change",
                key: "process-builder-body-hydration",
              },
              {
                version: 1,
                source: "extensions",
                type: "change",
                key: "*",
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(
        <SyncProbe
          queryClient={queryClient}
          suppressActionInvalidationFor={["process-builder-body-hydration"]}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // useDbSync coalesces invalidation into a single flush per
    // INVALIDATE_COALESCE_MS (250ms); wait past that window outside `act`
    // (see the comment in renderWithEvent above).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    expect(queryClient.calls).toEqual(
      expect.arrayContaining([
        { queryKey: ["action"] },
        { queryKey: ["extension"] },
        { queryKey: ["extensions"] },
        { queryKey: ["tool"] },
        { queryKey: ["tools"] },
      ]),
    );
  });

  it("keeps non-action events on targeted framework invalidations", async () => {
    const result = await renderWithEvent({
      version: 1,
      source: "settings",
      type: "change",
      key: "*",
    });
    roots.push(result.root);
    containers.push(result.container);

    expect(result.fetchMock).toHaveBeenCalled();
    expect(result.queryClient.calls).not.toContainEqual(undefined);
    expect(result.queryClient.calls).toContainEqual({ queryKey: ["action"] });
    expect(result.queryClient.refetchOptions).not.toContainEqual({
      cancelRefetch: true,
    });
    expect(result.queryClient.refetchOptions).toEqual(
      expect.arrayContaining([{ cancelRefetch: false }]),
    );
  });

  it("does not refetch action/extension/tool queries for app-state-only events", async () => {
    // Regression guard for the client fetch storm: an active agent session
    // mirrors navigation/selection into application_state continuously, and
    // the serverless poll path replays those writes back to the tab. Those
    // app-state events must NOT fan out into "refetch every action query"
    // (which exhausted the DB pool and surfaced downstream as stale_run).
    const result = await renderWithEvent({
      version: 1,
      source: "app-state",
      type: "change",
      key: "selection",
    });
    roots.push(result.root);
    containers.push(result.container);

    expect(result.fetchMock).toHaveBeenCalled();
    // The one query app-state writes legitimately refresh.
    expect(result.queryClient.calls).toContainEqual({
      queryKey: ["app-state"],
    });
    // But never the broad data-query prefixes.
    expect(result.queryClient.calls).not.toContainEqual(undefined);
    expect(result.queryClient.calls).not.toContainEqual({
      queryKey: ["action"],
    });
    expect(result.queryClient.calls).not.toContainEqual({
      queryKey: ["extension"],
    });
    expect(result.queryClient.calls).not.toContainEqual({
      queryKey: ["tool"],
    });
    expect(result.queryClient.calls).not.toContainEqual({
      queryKey: ["tools"],
    });
  });

  it("still refetches action queries when an action event rides alongside app-state churn", async () => {
    // A real mutation (action event) that ALSO writes navigation state must
    // still refresh action queries — the scoping only drops app-state-ONLY
    // batches from the data-query invalidation.
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [
              {
                version: 1,
                source: "app-state",
                type: "change",
                key: "navigate",
              },
              {
                version: 1,
                source: "action",
                type: "change",
                key: "create-slide",
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(queryClient.calls).toContainEqual({ queryKey: ["action"] });
    expect(queryClient.calls).not.toContainEqual(undefined);
    expect(queryClient.calls).toContainEqual({ queryKey: ["app-state"] });
    expect(queryClient.calls).toContainEqual({
      queryKey: ["navigate-command"],
    });
  });

  it("flushes app-state navigate/show-questions/__set_url__ events immediately, bypassing the coalesce window", async () => {
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [
              {
                version: 1,
                source: "app-state",
                type: "change",
                key: "navigate",
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Interaction-critical events (navigate/show-questions/__set_url__
    // app-state writes) must bypass INVALIDATE_COALESCE_MS entirely — no
    // 260ms wait needed, the invalidation lands in the same flush of
    // microtasks that delivered the event.
    expect(queryClient.calls).toContainEqual({ queryKey: ["app-state"] });
    expect(queryClient.calls).toContainEqual({
      queryKey: ["navigate-command"],
    });
  });

  it("flushes __set_url__ and show-questions app-state events immediately too", async () => {
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [
              {
                version: 1,
                source: "app-state",
                type: "change",
                key: "__set_url__",
              },
              {
                version: 1,
                source: "app-state",
                type: "change",
                key: "show-questions",
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(queryClient.calls).toContainEqual({ queryKey: ["__set_url__"] });
    expect(queryClient.calls).toContainEqual({
      queryKey: ["show-questions"],
    });
  });

  it("still coalesces pure action-change bursts into a single delayed flush", async () => {
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [
              {
                version: 1,
                source: "action",
                type: "change",
                key: "create-project",
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // No wait yet: a pure action-change batch (no interaction-critical
    // events) must still be sitting in the coalesce window, unflushed.
    expect(queryClient.calls).toHaveLength(0);

    // useDbSync coalesces invalidation into a single flush per
    // INVALIDATE_COALESCE_MS (250ms); wait past that window outside `act`
    // (see the comment in renderWithEvent above).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    expect(queryClient.calls).toEqual([{ queryKey: ["action"] }]);
  });

  it("backs off polling after repeated failures and resets on success", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClientProbe();
    let failing = true;
    const fetchMock = vi.fn(async () =>
      failing
        ? new Response("oops", { status: 500 })
        : new Response(JSON.stringify({ version: 1, events: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Mount poll = failure #1.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Base interval is 50ms, but after one failure the next poll is delayed
    // to 50 * 2^1 = 100ms — advancing past the base interval alone must NOT
    // trigger another poll.
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(50); // 110ms total ≥ 100ms backoff
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Failure #2 → next delay 50 * 2^2 = 200ms.
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    failing = false;
    await act(async () => {
      vi.advanceTimersByTime(60); // crosses the 200ms mark → poll #3 succeeds
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Success resets the backoff to the base 50ms interval.
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("polls at 60s while idle and switches immediately to 2s for an active agent run", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ version: 1, events: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    function AdaptiveProbe() {
      useDbSync({ queryClient, sseUrl: false, pauseWhenHidden: false });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    const pollCallCount = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/_agent-native/poll"),
      ).length;

    await act(async () => {
      root.render(<AdaptiveProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pollCallCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(pollCallCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(58_000);
    });
    expect(pollCallCount()).toBe(2);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "thread-1" },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pollCallCount()).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(pollCallCount()).toBe(4);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "thread-1" },
        }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(pollCallCount()).toBe(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(58_000);
    });
    expect(pollCallCount()).toBe(5);
  });

  it("subscribeSyncEvents shares the transport and reports SSE state on join", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 7,
            events: [{ version: 7, source: "collab", docId: "d1" }],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const received: SyncEvent[] = [];
    const sseStates: boolean[] = [];
    const unsubscribe = subscribeSyncEvents({
      onEvents: (events) => received.push(...events),
      onSseStateChange: (connected) => sseStates.push(connected),
      sseUrl: false,
      interval: 50,
      pauseWhenHidden: false,
    });

    // Joining reports the current SSE state immediately (disabled here).
    expect(sseStates).toEqual([false]);

    // The transport polls on start; events fan out to plain subscribers.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalled();
    expect(
      received.some(
        (event) => event.source === "collab" && event.docId === "d1",
      ),
    ).toBe(true);

    unsubscribe();
  });

  it("backs off polling after an auth failure", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response("Unauthorized", {
          status: 401,
          statusText: "Unauthorized",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores poll results that resolve after unmount", async () => {
    const queryClient = new QueryClientProbe();
    let resolvePoll:
      | ((response: Response | PromiseLike<Response>) => void)
      | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => root.unmount());

    await act(async () => {
      resolvePoll!(
        new Response(
          JSON.stringify({
            version: 1,
            events: [{ version: 1, source: "action", type: "change" }],
          }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(queryClient.calls).toEqual([]);
    container.remove();
  });

  // -------------------------------------------------------------------------
  // Shared transport regression tests
  // -------------------------------------------------------------------------

  it("uses a single fetch when useDbSync and useScreenRefreshKey are both mounted", async () => {
    const queryClient = new QueryClientProbe();
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          version: callCount,
          events: [{ version: callCount, source: "action", type: "change" }],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    function BothHooks() {
      useDbSync({
        queryClient,
        sseUrl: false,
        interval: 50,
        pauseWhenHidden: false,
      });
      useScreenRefreshKey({
        sseUrl: false,
        interval: 50,
        pauseWhenHidden: false,
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<BothHooks />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both hooks share the same transport — only ONE fetch call for the
    // initial poll, not two.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fans events to both useDbSync and useScreenRefreshKey subscribers", async () => {
    const queryClient = new QueryClientProbe();
    let capturedScreenKey = 0;

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [
              { version: 1, source: "action", type: "change" },
              { version: 2, source: "screen-refresh" },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    function BothHooks() {
      useDbSync({
        queryClient,
        sseUrl: false,
        interval: 50,
        pauseWhenHidden: false,
      });
      const k = useScreenRefreshKey({
        sseUrl: false,
        interval: 50,
        pauseWhenHidden: false,
      });
      capturedScreenKey = k;
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<BothHooks />);
      await Promise.resolve();
      await Promise.resolve();
    });
    // useDbSync coalesces invalidation into a single flush per
    // INVALIDATE_COALESCE_MS (250ms); wait past that window outside `act`
    // (see the comment in renderWithEvent above).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    // useDbSync received the action event and invalidated only action-backed
    // queries; it no longer fans the event across the entire active cache.
    expect(queryClient.calls).toContainEqual({ queryKey: ["action"] });
    expect(queryClient.calls).not.toContainEqual(undefined);
    // useScreenRefreshKey received the screen-refresh event.
    expect(capturedScreenKey).toBe(1);
  });

  it("creates a fresh transport after all subscribers unmount", async () => {
    let fetchCallCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCallCount++;
      return new Response(
        JSON.stringify({
          version: fetchCallCount,
          events: [{ version: fetchCallCount, source: "action" }],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const qc1 = new QueryClientProbe();
    const container1 = document.createElement("div");
    document.body.appendChild(container1);
    const root1 = createRoot(container1);

    await act(async () => {
      root1.render(<SyncProbe queryClient={qc1} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const afterFirst = fetchCallCount;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    // Unmount — transport tears down and registry entry is cleared.
    act(() => root1.unmount());
    container1.remove();

    // Re-mount should start a fresh transport (new poll from version 0).
    fetchCallCount = 0;
    const qc2 = new QueryClientProbe();
    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    roots.push(root2);
    containers.push(container2);

    await act(async () => {
      root2.render(<SyncProbe queryClient={qc2} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // New transport polls again from scratch.
    expect(fetchCallCount).toBeGreaterThanOrEqual(1);
  });
});

describe("isInteractionCriticalSyncEvent", () => {
  it("is true for navigate/show-questions/__set_url__ app-state events", () => {
    expect(
      isInteractionCriticalSyncEvent({
        source: "app-state",
        key: "navigate",
      }),
    ).toBe(true);
    expect(
      isInteractionCriticalSyncEvent({
        source: "app-state",
        key: "show-questions",
      }),
    ).toBe(true);
    expect(
      isInteractionCriticalSyncEvent({
        source: "app-state",
        key: "__set_url__",
      }),
    ).toBe(true);
  });

  it("is true for namespaced keys and the wildcard app-state key", () => {
    expect(
      isInteractionCriticalSyncEvent({
        source: "app-state",
        key: "navigate:tab-1",
      }),
    ).toBe(true);
    expect(
      isInteractionCriticalSyncEvent({ source: "app-state", key: "*" }),
    ).toBe(true);
  });

  it("is false for other app-state keys and non-app-state sources", () => {
    expect(
      isInteractionCriticalSyncEvent({
        source: "app-state",
        key: "some-other-key",
      }),
    ).toBe(false);
    expect(
      isInteractionCriticalSyncEvent({ source: "action", key: "navigate" }),
    ).toBe(false);
    expect(
      isInteractionCriticalSyncEvent({ source: "settings", key: "*" }),
    ).toBe(false);
    expect(
      isInteractionCriticalSyncEvent({ source: "collab", key: "navigate" }),
    ).toBe(false);
  });
});
