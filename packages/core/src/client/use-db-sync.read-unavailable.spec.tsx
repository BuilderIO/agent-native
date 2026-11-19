// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
  useDbSync,
} from "./use-db-sync.js";

const unavailable = () =>
  new Response(JSON.stringify({ error: "SYNC_EVENT_READ_UNAVAILABLE" }), {
    status: 409,
  });
const ok = (body: Record<string, unknown> = { version: 1, events: [] }) =>
  new Response(JSON.stringify(body));

describe("useDbSync durable read unavailable", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let providerFetches = 0;
  let providerAborts = 0;
  let pollResponses: Array<() => Response>;
  let pollCalls = 0;
  let pollUrls: string[] = [];
  const predicate = vi.fn(() => true);

  beforeEach(() => {
    vi.useFakeTimers();
    providerFetches = 0;
    providerAborts = 0;
    pollCalls = 0;
    pollUrls = [];
    pollResponses = [];
    predicate.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        pollCalls++;
        pollUrls.push(String(url));
        return (pollResponses.shift() ?? ok)();
      }),
    );
  });

  afterEach(() => {
    const mounted = root;
    if (mounted) act(() => mounted.unmount());
    container?.remove();
    root = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetSyncTransportRegistryForTests();
  });

  function Probe() {
    const queryClient = useQueryClient();
    useDbSync({
      queryClient: queryClient as never,
      sseUrl: false,
      realtime: { reason: "test durable read unavailable" },
      interval: 1000,
      fallbackInterval: 1000,
      pauseWhenHidden: false,
      actionInvalidatePredicate: predicate,
    });
    useQuery({
      queryKey: ["action", "list-things", undefined],
      queryFn: ({ signal }) => {
        providerFetches++;
        signal.addEventListener("abort", () => providerAborts++);
        return Promise.resolve(null);
      },
      staleTime: Infinity,
    });
    return null;
  }

  async function mount() {
    const client = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    const mountedRoot = createRoot(container);
    root = mountedRoot;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await act(async () => {
      mountedRoot.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    return client;
  }

  async function flush(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("does not re-poll or refetch providers in a tight loop on persistent 409", async () => {
    pollResponses = Array.from({ length: 50 }, () => unavailable);
    await mount();
    await flush();
    const afterFirstResync = providerFetches;
    expect(pollCalls).toBeLessThanOrEqual(3);

    await flush(1000);
    expect(pollCalls).toBeLessThanOrEqual(4);
    expect(providerFetches).toBe(afterFirstResync);
    expect(providerAborts).toBeLessThanOrEqual(1);
    expect(predicate).not.toHaveBeenCalled();
  });

  it("recovers after repeated 409s and applies later action events through the predicate", async () => {
    pollResponses = [
      ...Array.from({ length: 5 }, () => unavailable),
      () =>
        ok({
          version: 2,
          events: [
            { version: 2, source: "action", type: "change", key: "create" },
          ],
        }),
    ];
    await mount();
    await flush();
    expect(pollCalls).toBeLessThanOrEqual(3);

    await flush(300_000);
    expect(pollCalls).toBeGreaterThanOrEqual(6);
    expect(predicate).toHaveBeenCalled();
    const after = pollCalls;
    await flush(300_000);
    expect(pollCalls).toBeGreaterThan(after);
  });

  it("refreshes data and advances past a typed unreadable entry", async () => {
    pollResponses = [
      () => ok({ version: 5, events: [] }),
      () =>
        ok({
          version: 7,
          cursor: "7.row-b",
          events: [
            {
              version: 7,
              cursorId: "row-b",
              source: "action",
              type: "change",
              key: "create",
            },
          ],
          unreadable: [{ type: "access-unavailable" }],
        }),
    ];
    await mount();
    await flush();
    await flush(300_000);
    expect(providerFetches).toBeGreaterThanOrEqual(2);
    expect(predicate).toHaveBeenCalled();
    expect(pollUrls[2]).toContain("since=7");
  });

  it("refreshes for an unreadable event with unknown scope", async () => {
    pollResponses = [
      () => ok({ version: 5, events: [] }),
      () =>
        ok({
          version: 6,
          cursor: "6.row-a",
          events: [],
          unreadable: [{ type: "unknown-scope" }],
        }),
    ];
    await mount();
    await flush();
    await flush(300_000);
    expect(providerFetches).toBeGreaterThanOrEqual(2);
    expect(pollUrls[2]).toContain("since=6");
  });

  it("resets a non-zero cursor and resyncs once for a genuine unavailable read", async () => {
    pollResponses = [() => ok({ version: 5, events: [] }), unavailable];
    await mount();
    await flush();
    await flush(300_000);
    const unavailableIndex = 1;
    expect(pollUrls[unavailableIndex]).toContain("since=5");
    expect(pollUrls[unavailableIndex + 1]).toContain("since=0");
    expect(providerFetches).toBeGreaterThanOrEqual(2);
  });
});
