// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
  REALTIME_CAP_POLL_LIVE,
  subscribeSyncEvents,
  type SyncEvent,
} from "./use-db-sync";

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

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((message: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  received: unknown[] = [];
  closed = false;
  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer === this || peer.closed || peer.name !== this.name) continue;
      peer.received.push(data);
      peer.onmessage?.({ data });
    }
  }
  close(): void {
    this.closed = true;
  }
}

class FakeLockManager {
  static grant = true;
  static promote: Array<() => void> = [];
  static names: string[] = [];

  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void> {
    FakeLockManager.names.push(name);
    if (FakeLockManager.grant) return callback();
    return new Promise<void>((_resolve, reject) => {
      FakeLockManager.promote.push(() => void callback());
      options.signal?.addEventListener("abort", () =>
        reject(new Error("AbortError")),
      );
    });
  }
}

function installLocks(): void {
  Object.defineProperty(navigator, "locks", {
    value: new FakeLockManager(),
    configurable: true,
  });
}

function removeLocks(): void {
  Object.defineProperty(navigator, "locks", {
    value: undefined,
    configurable: true,
  });
}

const CHANGE: SyncEvent[] = [
  { version: 7, source: "app-state", type: "change", key: "*" } as SyncEvent,
];

describe("cross-tab SSE sharing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    FakeBroadcastChannel.instances = [];
    FakeLockManager.grant = true;
    FakeLockManager.promote = [];
    FakeLockManager.names = [];
    _resetSyncTransportRegistryForTests();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: 0, events: [] }),
      })),
    );
    installLocks();
  });

  afterEach(() => {
    _resetSyncTransportRegistryForTests();
    removeLocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens the stream when this tab wins the election", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    unsub();
  });

  it("opens no stream while another tab holds the election", async () => {
    FakeLockManager.grant = false;
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(200);

    expect(FakeEventSource.instances).toHaveLength(0);
    unsub();
  });

  it("requests the current SSE state when joining as a follower", async () => {
    FakeLockManager.grant = false;
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeBroadcastChannel.instances.at(-1)?.posted).toContainEqual({
      type: "sse-state-request",
    });
    unsub();
  });

  it("has the leader answer a follower state request", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(50);

    const leader = FakeBroadcastChannel.instances.at(-1)!;
    const requester = new FakeBroadcastChannel(leader.name);
    requester.postMessage({ type: "sse-state-request" });

    expect(requester.received).toContainEqual({
      type: "sse-state",
      connected: false,
      capabilities: [],
    });
    unsub();
    requester.close();
  });

  it("delivers the leader's events to a follower over the channel", async () => {
    FakeLockManager.grant = false;
    const received: SyncEvent[][] = [];
    const unsub = subscribeSyncEvents({
      onEvents: (events) => received.push(events),
    });
    await vi.advanceTimersByTimeAsync(50);

    const channel = FakeBroadcastChannel.instances.at(-1)!;
    channel.onmessage?.({
      data: { type: "events", events: CHANGE, version: 7 },
    });

    expect(received.at(-1)).toEqual(CHANGE);
    expect(FakeEventSource.instances).toHaveLength(0);
    unsub();
  });

  it("promotes a follower to leader when the holder releases", async () => {
    FakeLockManager.grant = false;
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(50);
    expect(FakeEventSource.instances).toHaveLength(0);

    FakeLockManager.promote.forEach((grant) => grant());
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    unsub();
  });

  it("forwards its own stream frames to followers while leading", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(50);

    const source = FakeEventSource.instances.at(-1)!;
    source.onmessage?.({
      data: JSON.stringify({ type: "batch", version: 7, events: CHANGE }),
    });

    const channel = FakeBroadcastChannel.instances.at(-1)!;
    expect(channel.posted).toContainEqual(
      expect.objectContaining({
        type: "events",
        events: CHANGE,
        version: 7,
        cursor: { version: 7, id: "" },
      }),
    );
    unsub();
  });

  it("never forwards the leader's ahead-of-frame cursor to followers", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes("/_agent-native/poll")) {
        return {
          ok: true,
          json: async () => ({
            version: 200,
            events: [],
            cursor: "200.z",
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ version: 0, events: [] }),
      } as Response;
    });
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(60_000);

    const source = FakeEventSource.instances.at(-1)!;
    source.onmessage?.({
      data: JSON.stringify({
        type: "batch",
        version: 100,
        events: [
          {
            version: 100,
            cursorId: "a",
            source: "app-state",
            type: "change",
            key: "*",
          },
        ],
      }),
    });

    const channel = FakeBroadcastChannel.instances.at(-1)!;
    expect(channel.posted.at(-1)).toEqual({
      type: "events",
      events: [expect.objectContaining({ version: 100, cursorId: "a" })],
      version: 100,
      cursor: { version: 100, id: "a" },
    });
    unsub();
  });

  it("elects a separate leader per app on a shared origin", async () => {
    const unsub = subscribeSyncEvents({
      onEvents: () => {},
      pollUrl: "/slides/_agent-native/poll",
      sseUrl: "/slides/_agent-native/events",
    });
    const unsubOther = subscribeSyncEvents({
      onEvents: () => {},
      pollUrl: "/design/_agent-native/poll",
      sseUrl: "/design/_agent-native/events",
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(new Set(FakeLockManager.names).size).toBe(2);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(
      new Set(FakeBroadcastChannel.instances.map((c) => c.name)).size,
    ).toBe(2);

    unsub();
    unsubOther();
  });

  it("broadcasts poll-live to followers when the leader's own stream is refused before opening", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {}, interval: 500 });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];
    source.readyState = FakeEventSource.CLOSED;
    source.onerror?.();

    const channel = FakeBroadcastChannel.instances.at(-1)!;
    expect(channel.posted).toContainEqual({
      type: "sse-state",
      connected: false,
      capabilities: [REALTIME_CAP_POLL_LIVE],
    });

    unsub();
  });

  it("notifies a follower's own subscribers of a capability-only frame (connected unchanged)", async () => {
    FakeLockManager.grant = false;
    const states: Array<{
      connected: boolean;
      capabilities: readonly string[] | undefined;
    }> = [];
    const unsub = subscribeSyncEvents({
      onEvents: () => {},
      onSseStateChange: (connected, capabilities) =>
        states.push({ connected, capabilities }),
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(states.at(-1)).toEqual({ connected: false, capabilities: [] });

    const channel = FakeBroadcastChannel.instances.at(-1)!;
    channel.onmessage?.({
      data: {
        type: "sse-state",
        connected: false,
        capabilities: [REALTIME_CAP_POLL_LIVE],
      },
    });

    expect(states.at(-1)).toEqual({
      connected: false,
      capabilities: [REALTIME_CAP_POLL_LIVE],
    });

    unsub();
  });

  it("keeps one stream per tab when Web Locks is unavailable", async () => {
    removeLocks();
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    unsub();
  });
});
