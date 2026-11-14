// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));

import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import { resetActionGetBatchForTests } from "./action-get-batch.js";
import { useActionQuery } from "./use-action.js";
import {
  _resetSyncTransportRegistryForTests,
  useDbSync,
} from "./use-db-sync.js";

let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.useFakeTimers();
  _resetSyncTransportRegistryForTests();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  _resetSyncTransportRegistryForTests();
  resetActionFailureCircuits();
  resetActionGetBatchForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it.each([1, 2])(
  "refreshes idle reads once per event across %i overlapping sync batches, with one busy follow-up 700 ms later",
  async (eventCount) => {
    const calls = new Map<string, number>();
    let releaseBusy: (() => void) | undefined;
    const busy = new Promise<void>((resolve) => {
      releaseBusy = resolve;
    });
    let poll = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = new URL(url, "http://app.test").pathname;
        if (path === "/_agent-native/poll") {
          poll += 1;
          return Response.json({
            version: poll,
            events: [{ version: poll, source: "action", key: "remote-write" }],
          });
        }
        const action = path.split("/").at(-1) ?? "";
        const count = (calls.get(action) ?? 0) + 1;
        calls.set(action, count);
        if (action === "get-busy-read" && count === 1) await busy;
        return Response.json({ revision: count });
      }),
    );

    function Read({ name }: { name: string }) {
      useActionQuery(name, {}, { batchRefetches: false, retry: false });
      return null;
    }
    function Reads() {
      return (
        <>
          <Read name="list-gmail-labels" />
          <Read name="get-mail-split-config" />
          <Read name="get-busy-read" />
        </>
      );
    }
    function Sync() {
      useDbSync({
        queryClient: client,
        actionInvalidatePredicate: () => true,
        sseUrl: false,
        realtime: { reason: "remote mailbox changes" },
        interval: 60_000,
        fallbackInterval: 60_000,
      });
      return null;
    }
    async function render(sync: boolean) {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Reads />
            {sync && <Sync />}
          </QueryClientProvider>,
        );
      });
    }

    await render(false);
    await advance(0);
    await render(true);
    await advance(250);
    expect(calls.get("list-gmail-labels")).toBe(2);
    expect(calls.get("get-mail-split-config")).toBe(2);
    for (let event = 1; event < eventCount; event += 1) {
      act(() => {
        window.dispatchEvent(
          new CustomEvent("agent-native:tool-done", {
            detail: { tool: "remote-write", completedSideEffect: true },
          }),
        );
      });
      await advance(250);
    }
    await advance(700 - (eventCount - 1) * 250);
    await act(async () => releaseBusy?.());
    await advance(0);

    expect(calls.get("list-gmail-labels")).toBe(eventCount + 1);
    expect(calls.get("get-mail-split-config")).toBe(eventCount + 1);
    expect(calls.get("get-busy-read")).toBe(2);
    expect(client.isFetching()).toBe(0);

    await advance(60_000);
    expect(poll).toBe(2);
    expect(calls.get("list-gmail-labels")).toBe(eventCount + 2);
    expect(calls.get("get-mail-split-config")).toBe(eventCount + 2);
    expect(calls.get("get-busy-read")).toBe(3);
    expect(client.isFetching()).toBe(0);
  },
);
