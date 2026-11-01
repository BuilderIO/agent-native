// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
  syncInvalidationsAfter,
  useDbSync,
} from "./use-db-sync.js";

// A read sent before anything in the tab watched for changes (the page read
// the document head sends) answers with the sync cursor its server read at.
// Sync may already have invalidated keys by the time the app watches for that
// read, and a key nothing cached then shows no trace of it. Each invalidation
// sync asks is kept with the cursor of the newest change behind it, so the
// read can be told which changes came after it.

class QueryClientProbe {
  invalidateQueries() {
    return Promise.resolve();
  }
}

function Probe({ queryClient }: { queryClient: QueryClientProbe }) {
  useDbSync({
    queryClient,
    sseUrl: false,
    realtime: { reason: "test the sync invalidation log" },
    // Far enough apart that each poll's batch is invalidated on its own,
    // not coalesced with the next.
    interval: 1_000,
    fallbackInterval: 1_000,
    pauseWhenHidden: false,
  });
  return null;
}

// The tab's own event stream, which hears changes as they happen.
function StreamProbe({ queryClient }: { queryClient: QueryClientProbe }) {
  useDbSync({
    queryClient,
    sseUrl: "/_agent-native/events",
    realtime: { reason: "test the sync invalidation log" },
    interval: 1_000,
    fallbackInterval: 1_000,
    pauseWhenHidden: false,
  });
  return null;
}

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  addEventListener(): void {}
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

type PolledEvent = {
  version: number;
  cursorId?: string;
  source: string;
  key?: string;
};

describe("the invalidations sync asked, by sync cursor", () => {
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

  // Each poll answers the next batch of changes, then nothing.
  async function deliver(batches: PolledEvent[][]) {
    const queryClient = new QueryClientProbe();
    let poll = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const events = batches[poll] ?? [];
        poll += 1;
        const version = Math.max(0, ...events.map((event) => event.version));
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
    for (let step = 0; step <= batches.length; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_300);
      });
    }
    return queryClient;
  }

  it("tells a read the invalidations for changes after its cursor, and none at or before it", async () => {
    const queryClient = await deliver([
      [{ version: 4, cursorId: "e4", source: "action", key: "add-item" }],
      [{ version: 6, cursorId: "e6", source: "action", key: "add-item" }],
    ]);

    expect(syncInvalidationsAfter(queryClient, "3.e3")?.length).toBe(2);
    expect(syncInvalidationsAfter(queryClient, "5.e5")?.length).toBe(1);
    expect(syncInvalidationsAfter(queryClient, "6.e6")).toEqual([]);
    expect(syncInvalidationsAfter(queryClient, "7.")).toEqual([]);
  });

  it("keeps a key prefix it was asked, and a predicate as reaching every query", async () => {
    const queryClient = await deliver([
      [{ version: 6, cursorId: "e6", source: "db" }],
    ]);

    const asked = syncInvalidationsAfter(queryClient, "5.e5") ?? [];
    expect(asked).toContainEqual({ queryKey: ["action"] });
    expect(asked).toContainEqual({ queryKey: ["extensions"] });
  });

  it("counts a change from this tab itself, which has no cursor, as after every read", async () => {
    const queryClient = await deliver([
      [{ version: 0, source: "action", key: "add-item" }],
    ]);

    expect(syncInvalidationsAfter(queryClient, "99.z")?.length).toBe(1);
  });

  it("tells a read with no cursor every invalidation it has", async () => {
    const queryClient = await deliver([
      [{ version: 4, cursorId: "e4", source: "action", key: "add-item" }],
    ]);

    expect(syncInvalidationsAfter(queryClient)?.length).toBe(1);
    expect(syncInvalidationsAfter(new QueryClientProbe())).toEqual([]);
  });

  describe("when the stream hears a change before the first poll answers", () => {
    const e4: PolledEvent = {
      version: 4,
      cursorId: "e4",
      source: "action",
      key: "add-item",
    };
    const e6: PolledEvent = {
      version: 6,
      cursorId: "e6",
      source: "action",
      key: "add-item",
    };

    // The first poll goes out at once and is held; the stream then hears e6.
    async function streamAheadOfFirstPoll() {
      const queryClient = new QueryClientProbe();
      FakeEventSource.instances = [];
      vi.stubGlobal("EventSource", FakeEventSource);
      const polls: Array<(events: PolledEvent[]) => void> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              polls.push((events) => {
                const version = Math.max(0, ...events.map((e) => e.version));
                resolve(new Response(JSON.stringify({ version, events })));
              });
            }),
        ),
      );
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(<StreamProbe queryClient={queryClient} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(polls).toHaveLength(1);
      await act(async () => {
        FakeEventSource.instances.at(-1)?.onmessage?.({
          data: JSON.stringify({ version: 6, events: [e6] }),
        });
        await vi.advanceTimersByTimeAsync(1_300);
      });
      return { queryClient, answerFirstPoll: polls[0] };
    }

    it("cannot tell a read anything until a poll says where the log starts", async () => {
      const { queryClient } = await streamAheadOfFirstPoll();

      expect(syncInvalidationsAfter(queryClient, "3.e3")).toBeUndefined();
      expect(syncInvalidationsAfter(queryClient)).toBeUndefined();
    });

    it("cannot tell a read older than the stream's change, whose earlier changes the poll then skips", async () => {
      const { queryClient, answerFirstPoll } = await streamAheadOfFirstPoll();
      // The poll was sent from the start and names e4 and e6, but e6 already
      // moved the tab past e4, so e4 never reaches the log.
      await act(async () => {
        answerFirstPoll?.([e4, e6]);
        await vi.advanceTimersByTimeAsync(1_300);
      });

      expect(syncInvalidationsAfter(queryClient, "3.e3")).toBeUndefined();
      expect(syncInvalidationsAfter(queryClient)).toBeUndefined();
      expect(syncInvalidationsAfter(queryClient, "6.e6")).toEqual([]);
    });
  });

  it("tells a read every change after its cursor when the first poll started from the beginning", async () => {
    const queryClient = await deliver([[]]);

    expect(syncInvalidationsAfter(queryClient, "3.e3")).toEqual([]);
  });

  it("cannot tell an unreadable cursor, or one older than the invalidations it no longer keeps", async () => {
    // Each change asks eight invalidations; thirty of them overrun the log.
    const queryClient = await deliver(
      Array.from({ length: 30 }, (_, index) => [
        { version: index + 1, cursorId: `e${index + 1}`, source: "db" },
      ]),
    );

    expect(syncInvalidationsAfter(queryClient, "not-a-cursor")).toBeUndefined();
    expect(syncInvalidationsAfter(queryClient, "1.e1")).toBeUndefined();
    expect(syncInvalidationsAfter(queryClient, "29.e29")?.length).toBe(8);
  });
});
