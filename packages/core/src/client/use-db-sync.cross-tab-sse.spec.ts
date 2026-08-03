// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
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
  closed = false;
  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

/**
 * Stands in for `navigator.locks`. `grant` controls whether this "tab" wins the
 * election immediately (leader) or waits behind another tab (follower), which
 * is the only difference the transport is allowed to observe.
 */
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

  // The whole point: a second tab must not spend one of the origin's ~6
  // HTTP/1.1 connections on a duplicate stream.
  it("opens no stream while another tab holds the election", async () => {
    FakeLockManager.grant = false;
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(200);

    expect(FakeEventSource.instances).toHaveLength(0);
    unsub();
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

    // The previous leader closed its tab; Web Locks hands the lock over.
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
    expect(channel.posted).toContainEqual({
      type: "events",
      events: CHANGE,
      version: 7,
    });
    unsub();
  });

  // The dev gateway serves every workspace app from one origin. Electing per
  // origin would give a design tab the slides leader's events, and the follower
  // would fold them into the `?since=` cursor for its OWN poll — silently
  // skipping its own app's changes from then on.
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

    // Two apps, two locks, two streams — neither is a follower of the other.
    expect(new Set(FakeLockManager.names).size).toBe(2);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(
      new Set(FakeBroadcastChannel.instances.map((c) => c.name)).size,
    ).toBe(2);

    unsub();
    unsubOther();
  });

  it("keeps one stream per tab when Web Locks is unavailable", async () => {
    removeLocks();
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    unsub();
  });
});
