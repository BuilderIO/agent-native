// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
  subscribeSyncEvents,
} from "./use-db-sync";

/** Minimal EventSource stand-in that records every constructed instance so the
 * test can inspect the URL each connect was built with. */
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

    // Mint resolves, then the first stream opens with the token and no cursor.
    await vi.advanceTimersByTimeAsync(200);
    const first = FakeEventSource.instances.at(-1)!;
    expect(first.url).toContain("token=tok-1");
    expect(first.url).not.toContain("since=");

    first.readyState = FakeEventSource.OPEN;
    first.onopen?.();

    // A delivered batch advances the transport cursor to 100.
    first.onmessage?.({
      data: JSON.stringify({
        type: "batch",
        version: 100,
        events: [
          { version: 100, source: "app-state", type: "change", key: "*" },
        ],
      }),
    });

    // Transient (CONNECTING) error: the browser would auto-reconnect this same
    // instance with its frozen URL. We must own it and close the stream.
    first.readyState = FakeEventSource.CONNECTING;
    first.onerror?.();
    expect(first.readyState).toBe(FakeEventSource.CLOSED);

    // The owned reconnect builds a NEW stream carrying the current cursor and
    // the still-valid token (no re-mint on a transient error).
    await vi.advanceTimersByTimeAsync(1500);
    const second = FakeEventSource.instances.at(-1)!;
    expect(second).not.toBe(first);
    expect(second.url).toContain("since=100");
    expect(second.url).toContain("token=tok-1");

    unsub();
  });
});
