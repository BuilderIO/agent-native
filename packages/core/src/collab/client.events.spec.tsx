// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEvent } from "../client/use-db-sync.js";
import { REALTIME_CAP_POLL_LIVE } from "../realtime-protocol.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
} from "./client.js";

const shared = vi.hoisted(() => ({
  subscriptions: new Set<{
    onEvents: (events: SyncEvent[]) => void;
    onSseStateChange?: (connected: boolean, capabilities?: string[]) => void;
  }>(),
}));
vi.mock("../client/use-db-sync.js", async (original) => ({
  ...(await original<typeof import("../client/use-db-sync.js")>()),
  subscribeSyncEvents: (options: {
    onEvents: (events: SyncEvent[]) => void;
  }) => {
    shared.subscriptions.add(options);
    return () => shared.subscriptions.delete(options);
  },
}));

function Probe({ onEvent }: { onEvent: (event: SyncEvent) => void }) {
  useCollaborativeDoc({ docId: "mailbox-doc", onEvent });
  return null;
}

describe("collaborative document application events", () => {
  let root: Root;
  let container: HTMLDivElement;
  let events: SyncEvent[];
  let pollCalls: number;
  const flushRequest: SyncEvent = {
    version: 2,
    source: "app-state",
    key: "flush-request-mailbox-doc",
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    _resetCollabDocRegistryForTests();
    shared.subscriptions.clear();
    events = [];
    pollCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (/\/collab\/[^/]+\/state/.test(url)) {
          return new Response(
            JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
          );
        }
        if (url.includes("/_agent-native/poll")) {
          pollCalls += 1;
          return new Response(
            JSON.stringify({ version: events.length ? 2 : 1, events }),
          );
        }
        return new Response(JSON.stringify({ states: [] }));
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    _resetCollabDocRegistryForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("delivers a flush request through the existing two-second fallback poll", async () => {
    let flushRequested = false;
    const onEvent = vi.fn((event: SyncEvent) => {
      if (
        event.source === "app-state" &&
        event.key === "flush-request-mailbox-doc"
      ) {
        flushRequested = true;
      }
    });
    act(() => root.render(<Probe onEvent={onEvent} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const baselinePollCalls = pollCalls;
    events = [flushRequest];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith(flushRequest);
    expect(flushRequested).toBe(true);
    expect(pollCalls - baselinePollCalls).toBe(1);
  });

  it("uses the latest callback without replacing the document subscriptions", async () => {
    const previous = vi.fn();
    const latest = vi.fn();
    act(() => root.render(<Probe onEvent={previous} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const subscriptions = [...shared.subscriptions];
    act(() => root.render(<Probe onEvent={latest} />));
    expect([...shared.subscriptions]).toEqual(subscriptions);
    act(() => {
      for (const subscription of shared.subscriptions) {
        subscription.onEvents([flushRequest]);
      }
    });
    expect(previous).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith(flushRequest);
  });

  it("delivers hosted poll-live events at the existing twelve-second cadence", async () => {
    const onEvent = vi.fn();
    act(() => root.render(<Probe onEvent={onEvent} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    act(() => {
      for (const subscription of shared.subscriptions) {
        subscription.onSseStateChange?.(false, [REALTIME_CAP_POLL_LIVE]);
      }
    });
    const baselinePollCalls = pollCalls;
    events = [flushRequest];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11999);
    });
    expect(onEvent).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith(flushRequest);
    expect(pollCalls - baselinePollCalls).toBe(1);
  });
});
