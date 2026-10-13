// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
  REALTIME_CAP_POLL_LIVE,
  subscribeSyncEvents,
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

describe("hosted SSE reconnect ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    _resetSyncTransportRegistryForTests();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/_agent-native/realtime-token")) {
          return {
            ok: true,
            json: async () => ({ token: "tok-1", ttlSeconds: 600 }),
          };
        }
        return { ok: true, json: async () => ({ version: 0, events: [] }) };
      }),
    );
    (
      window as unknown as { __AGENT_NATIVE_CONFIG__: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      realtime: { transport: "hosted", gatewayBaseUrl: "https://gw.example" },
    };
  });

  afterEach(() => {
    _resetSyncTransportRegistryForTests();
    delete (window as unknown as { __AGENT_NATIVE_CONFIG__?: unknown })
      .__AGENT_NATIVE_CONFIG__;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("rebuilds the stream URL with the current cursor on a browser-managed reconnect", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {} });

    await vi.advanceTimersByTimeAsync(200);
    const first = FakeEventSource.instances.at(-1)!;
    expect(first.url).toContain("token=tok-1");
    expect(first.url).not.toContain("since=");

    first.readyState = FakeEventSource.OPEN;
    first.onopen?.();

    first.onmessage?.({
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

    first.readyState = FakeEventSource.CONNECTING;
    first.onerror?.();
    expect(first.readyState).toBe(FakeEventSource.CLOSED);

    await vi.advanceTimersByTimeAsync(1500);
    const second = FakeEventSource.instances.at(-1)!;
    expect(second).not.toBe(first);
    expect(second.url).toContain("since=100");
    expect(second.url).toContain("cursor=100.a");
    expect(second.url).toContain("token=tok-1");

    unsub();
  });

  it("ignores a late error from a replaced (stale) stream", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(200);
    const first = FakeEventSource.instances.at(-1)!;
    first.readyState = FakeEventSource.OPEN;
    first.onopen?.();

    first.readyState = FakeEventSource.CONNECTING;
    first.onerror?.();
    await vi.advanceTimersByTimeAsync(1500);
    const second = FakeEventSource.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.readyState = FakeEventSource.OPEN;
    second.onopen?.();

    const countBefore = FakeEventSource.instances.length;
    first.readyState = FakeEventSource.CONNECTING;
    first.onerror?.();
    await vi.advanceTimersByTimeAsync(1500);

    expect(second.readyState).toBe(FakeEventSource.OPEN);
    expect(FakeEventSource.instances.length).toBe(countBefore);

    unsub();
  });

  it("health-gates to the local stream once the gateway trips the threshold", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {} });

    await vi.advanceTimersByTimeAsync(200);
    expect(FakeEventSource.instances.at(-1)!.url).toContain("gw.example");

    for (let i = 0; i < 3; i++) {
      const current = FakeEventSource.instances.at(-1)!;
      current.readyState = FakeEventSource.CLOSED;
      current.onerror?.();
      await vi.advanceTimersByTimeAsync(1500);
    }

    const afterGate = FakeEventSource.instances.at(-1)!;
    expect(afterGate.url).toContain("/_agent-native/events");
    expect(afterGate.url).not.toContain("gw.example");

    unsub();
  });

  it("polls the local app at local cadence after health-gating, not gateway backoff", async () => {
    const pollUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/_agent-native/realtime-token")) {
          return {
            ok: true,
            json: async () => ({ token: "tok-1", ttlSeconds: 600 }),
          };
        }
        if (url.includes("/poll")) pollUrls.push(url);
        if (url.includes("gw.example")) throw new Error("gateway down");
        return { ok: true, json: async () => ({ version: 0, events: [] }) };
      }),
    );

    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await vi.advanceTimersByTimeAsync(200);

    for (let i = 0; i < 3; i++) {
      const current = FakeEventSource.instances.at(-1)!;
      current.readyState = FakeEventSource.CLOSED;
      current.onerror?.();
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(FakeEventSource.instances.at(-1)!.url).toContain(
      "/_agent-native/events",
    );

    const before = pollUrls.filter((u) =>
      u.includes("/_agent-native/poll"),
    ).length;
    await vi.advanceTimersByTimeAsync(75_000);
    const after = pollUrls.filter((u) =>
      u.includes("/_agent-native/poll"),
    ).length;
    expect(after).toBeGreaterThan(before);

    unsub();
  });

  it("never reports poll-live for a hosted-gateway stream refused before it ever opened", async () => {
    const capabilities: Array<readonly string[] | undefined> = [];
    const unsub = subscribeSyncEvents({
      onEvents: () => {},
      onSseStateChange: (_connected, caps) => capabilities.push(caps),
    });
    await vi.advanceTimersByTimeAsync(200);

    const first = FakeEventSource.instances.at(-1)!;
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    await vi.advanceTimersByTimeAsync(1500);

    expect(
      capabilities.some((caps) => caps?.includes(REALTIME_CAP_POLL_LIVE)),
    ).toBe(false);

    unsub();
  });
});
