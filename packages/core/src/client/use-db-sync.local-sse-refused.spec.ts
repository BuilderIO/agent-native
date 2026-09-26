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

describe("local SSE refusal (serverless 204)", () => {
  const pollUrls: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    pollUrls.length = 0;
    _resetSyncTransportRegistryForTests();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/_agent-native/poll")) pollUrls.push(url);
        return { ok: true, json: async () => ({ version: 0, events: [] }) };
      }),
    );
    // No __AGENT_NATIVE_CONFIG__.realtime → transport starts in "local" mode,
    // the path this fix touches. Hosted-gateway mode is untouched.
  });

  afterEach(() => {
    _resetSyncTransportRegistryForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reports poll-live to existing and late subscribers on a refusal, backs off on the short schedule before retrying, and keeps polling", async () => {
    const states: Array<{
      connected: boolean;
      capabilities: readonly string[] | undefined;
    }> = [];
    const unsub = subscribeSyncEvents({
      onEvents: () => {},
      onSseStateChange: (connected, capabilities) =>
        states.push({ connected, capabilities }),
      interval: 500,
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0];
    expect(first.url).toContain("poll_live=1");

    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();

    const refusalState = states.at(-1);
    expect(refusalState?.connected).toBe(false);
    expect(refusalState?.capabilities).toContain(REALTIME_CAP_POLL_LIVE);

    const lateStates: Array<readonly string[] | undefined> = [];
    const unsubLate = subscribeSyncEvents({
      onEvents: () => {},
      onSseStateChange: (_connected, capabilities) =>
        lateStates.push(capabilities),
      interval: 500,
    });
    expect(lateStates[0]).toContain(REALTIME_CAP_POLL_LIVE);
    unsubLate();

    const pollsBefore = pollUrls.length;
    await vi.advanceTimersByTimeAsync(1_000 - 1);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(pollUrls.length).toBeGreaterThan(pollsBefore);

    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    unsub();
  });

  it("drops poll-live once a retried attempt actually opens", async () => {
    const states: Array<readonly string[] | undefined> = [];
    const unsub = subscribeSyncEvents({
      onEvents: () => {},
      onSseStateChange: (_connected, capabilities) => states.push(capabilities),
      interval: 500,
    });
    await vi.advanceTimersByTimeAsync(50);

    const first = FakeEventSource.instances[0];
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    expect(states.at(-1)).toContain(REALTIME_CAP_POLL_LIVE);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    const second = FakeEventSource.instances[1];
    second.readyState = FakeEventSource.OPEN;
    second.onopen?.();

    expect(states.at(-1)).not.toContain(REALTIME_CAP_POLL_LIVE);

    unsub();
  });

  it("still reconnects with backoff when a stream opens and later drops", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {}, interval: 500 });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0];
    first.readyState = FakeEventSource.OPEN;
    first.onopen?.();

    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(FakeEventSource.instances).toHaveLength(2);

    unsub();
  });

  it("keeps reconnecting when a reconnect attempt (not the first one) is refused before opening", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {}, interval: 500 });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0];
    first.readyState = FakeEventSource.OPEN;
    first.onopen?.();

    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeEventSource.instances).toHaveLength(2);

    const second = FakeEventSource.instances[1];
    second.readyState = FakeEventSource.CLOSED;
    second.onerror?.();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(FakeEventSource.instances).toHaveLength(3);

    unsub();
  });

  it("stays on the short schedule until its cap fires three times, then falls back to the long backoff, capped at 60 minutes", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {}, interval: 500 });
    await vi.advanceTimersByTimeAsync(50);

    const expectedDelays = [
      1_000,
      2_000,
      4_000,
      8_000,
      16_000,
      30_000,
      30_000,
      30_000,
      5 * 60_000,
      10 * 60_000,
      20 * 60_000,
      40 * 60_000,
    ];
    for (const delay of expectedDelays) {
      const current = FakeEventSource.instances.at(-1)!;
      const countBefore = FakeEventSource.instances.length;
      current.readyState = FakeEventSource.CLOSED;
      current.onerror?.();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeEventSource.instances.length).toBe(countBefore);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeEventSource.instances.length).toBe(countBefore + 1);
    }

    const countBeforeCap = FakeEventSource.instances.length;
    const latest = FakeEventSource.instances.at(-1)!;
    latest.readyState = FakeEventSource.CLOSED;
    latest.onerror?.();
    await vi.advanceTimersByTimeAsync(60 * 60_000 - 1);
    expect(FakeEventSource.instances.length).toBe(countBeforeCap);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances.length).toBe(countBeforeCap + 1);

    unsub();
  });

  it("retries after the surface is hidden and shown again during refusal backoff, instead of latching permanently", async () => {
    const unsub = subscribeSyncEvents({
      onEvents: () => {},
      interval: 500,
      pauseWhenHidden: true,
    });
    await vi.advanceTimersByTimeAsync(50);

    const first = FakeEventSource.instances[0];
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    expect(FakeEventSource.instances).toHaveLength(1);

    const visibilitySpy = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    visibilitySpy.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(50);
    expect(FakeEventSource.instances).toHaveLength(2);

    visibilitySpy.mockRestore();
    unsub();
  });

  it("retries after a local /poll 401 cooldown during refusal backoff, instead of latching permanently", async () => {
    let pollStatus = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/_agent-native/poll")) {
          pollUrls.push(url);
          if (pollStatus !== 200) return { ok: false, status: pollStatus };
        }
        return { ok: true, json: async () => ({ version: 0, events: [] }) };
      }),
    );

    const unsub = subscribeSyncEvents({ onEvents: () => {}, interval: 500 });
    await vi.advanceTimersByTimeAsync(50);

    const first = FakeEventSource.instances[0];
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    expect(FakeEventSource.instances).toHaveLength(1);

    pollStatus = 401;
    await vi.advanceTimersByTimeAsync(1_000);
    pollStatus = 200;
    expect(FakeEventSource.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(58_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    unsub();
  });
});
