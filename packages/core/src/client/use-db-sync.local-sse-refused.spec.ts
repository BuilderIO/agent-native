// @vitest-environment happy-dom

/**
 * On a serverless host, `/_agent-native/events` answers a bare 204 instead of
 * holding the invocation (see `core-routes-plugin.sse-serverless.spec.ts`).
 * Under the EventSource spec, a non-200 response is a terminal failure: the
 * browser closes the connection and does NOT auto-reconnect. This transport
 * owns local reconnects itself: a refusal before the stream ever opened
 * reports REALTIME_CAP_POLL_LIVE so subscribers (DeckContext, collab/
 * client.ts) keep their normal cadence instead of mistaking "no push" for
 * "live channel down" — on that deploy target /poll is the live channel
 * already — and retries on a two-tier backoff. It starts on the same short
 * schedule as an ordinary network blip (base 1s, doubling, capped at 30s),
 * since a never-opened stream is as likely to be a transient 401/502/proxy
 * hiccup as a permanent serverless refusal; only once that schedule's cap has
 * fired three times (~2 minutes in) does it fall back to a long backoff
 * (5 min, doubling to a 60 min cap) so a serverless deploy isn't billed a
 * fresh cold container every 30 seconds forever. A stream that DID open and
 * later drops keeps the short schedule throughout, and polling keeps running
 * across every tier.
 */
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
    // The server's 204 gate only fires for a request that opts in — this is
    // the only client-side half of that contract (see core-routes-plugin.ts).
    expect(first.url).toContain("poll_live=1");

    // The server refuses with a 204: EventSource fails before `onopen` ever
    // fires.
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();

    const refusalState = states.at(-1);
    expect(refusalState?.connected).toBe(false);
    expect(refusalState?.capabilities).toContain(REALTIME_CAP_POLL_LIVE);

    // A subscriber joining after the refusal gets poll-live immediately —
    // it must not wait for the next retry to learn the channel is down.
    const lateStates: Array<readonly string[] | undefined> = [];
    const unsubLate = subscribeSyncEvents({
      onEvents: () => {},
      onSseStateChange: (_connected, capabilities) =>
        lateStates.push(capabilities),
      interval: 500,
    });
    expect(lateStates[0]).toContain(REALTIME_CAP_POLL_LIVE);
    unsubLate();

    // No retry before the short schedule's first delay (base 1s), but
    // polling never stops.
    const pollsBefore = pollUrls.length;
    await vi.advanceTimersByTimeAsync(1_000 - 1);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(pollUrls.length).toBeGreaterThan(pollsBefore);

    // The retry fires at the 1-second mark, not the long tier's 5 minutes —
    // a never-opened stream gets the same fast first retry as a network blip.
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

    // The retry is the short schedule's first attempt (1s), not the long
    // tier — only a streak of never-opened refusals falls back to that.
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

    // A network blip after a healthy connection — not a refusal.
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();

    // LOCAL_SSE_RECONNECT_BASE_MS is 1s.
    await vi.advanceTimersByTimeAsync(1_500);

    expect(FakeEventSource.instances).toHaveLength(2);

    unsub();
  });

  it("keeps reconnecting when a reconnect attempt (not the first one) is refused before opening", async () => {
    // A stream that opened once must not be mistaken for a fresh refusal on a
    // later reconnect — "ever opened" is tracked per transport, not per
    // EventSource instance (each reconnect creates a new one).
    const unsub = subscribeSyncEvents({ onEvents: () => {}, interval: 500 });
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0];
    first.readyState = FakeEventSource.OPEN;
    first.onopen?.();

    // A network blip after a healthy connection — not a refusal.
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeEventSource.instances).toHaveLength(2);

    // The reconnect itself gets refused before it ever opens (e.g. a 502 from
    // a proxy mid-restart, or a load balancer hiccup during a deploy) — this
    // must still be treated as a network blip, not a permanent refusal, since
    // this transport has opened before.
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

    // Short tier (same schedule as an opened-then-dropped stream): base 1s,
    // doubling, capped at 30s — the cap fires three times (attempts 5-7)
    // before the long tier takes over. Long tier: 5min -> 10min -> 20min ->
    // 40min, each double the last.
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

    // The next doubling (5min * 2^4 = 80min) is capped at 60min instead.
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

    // The pending refusal retry (short tier, 1s) is cancelled by
    // closeEvents() when the surface goes hidden — this must not latch the
    // never-opened stream refused forever, whichever tier it was mid-backoff.
    const visibilitySpy = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    // Coming back into view must retry immediately, not wait out a cancelled
    // timer that will never fire again.
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

    // A 401 on /poll closes the pending refusal-retry timer via closeEvents()
    // (POLL_AUTH_FAILURE_COOLDOWN_MS, 60s) — this must not latch the
    // never-opened stream refused forever either. Let the failing poll
    // actually run.
    pollStatus = 401;
    await vi.advanceTimersByTimeAsync(1_000);
    pollStatus = 200;
    expect(FakeEventSource.instances).toHaveLength(1);

    // Still inside the 60s cooldown — no retry yet.
    await vi.advanceTimersByTimeAsync(58_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    // The cooldown poll succeeds and retries SSE directly, instead of
    // waiting on a focus/visibility trigger that may never come.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    unsub();
  });
});
