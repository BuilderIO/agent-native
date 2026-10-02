// @vitest-environment happy-dom

/**
 * Collab poll boost: with no stream connected (serverless refuses /events),
 * a held lease polls every 2.5 s instead of the 1-5 minute idle cadence, and
 * costs nothing when no lease is held or a stream is live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBrowserTabId } from "./browser-tab-id";
import {
  _resetSyncTransportRegistryForTests,
  acquireCollabPollBoost,
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

describe("collab poll boost", () => {
  let polls = 0;
  let nextEvents: Array<Record<string, unknown>> = [];

  async function advance(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  async function subscribeRefused() {
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await advance(50);
    const source = FakeEventSource.instances[0];
    source.readyState = FakeEventSource.CLOSED;
    source.onerror?.();
    await advance(50);
    return unsub;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    polls = 0;
    nextEvents = [];
    FakeEventSource.instances = [];
    _resetSyncTransportRegistryForTests();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/_agent-native/poll")) {
          polls += 1;
          const events = nextEvents;
          nextEvents = [];
          return { ok: true, json: async () => ({ version: polls, events }) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    _resetSyncTransportRegistryForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("polls every 2.5 s while a lease is held and the stream is refused, then returns to the idle cadence on release", async () => {
    const unsub = await subscribeRefused();
    const idleBefore = polls;
    await advance(30_000);
    expect(polls - idleBefore).toBe(0);

    const release = acquireCollabPollBoost();
    const boostedFrom = polls;
    await advance(30_000);
    expect(polls - boostedFrom).toBeGreaterThanOrEqual(11);
    expect(polls - boostedFrom).toBeLessThanOrEqual(14);

    release();
    const releasedAt = polls;
    await advance(30_000);
    expect(polls - releasedAt).toBeLessThanOrEqual(1);
    unsub();
  });

  it("does not boost while a stream is connected", async () => {
    const unsub = subscribeSyncEvents({ onEvents: () => {} });
    await advance(50);
    const source = FakeEventSource.instances[0];
    source.readyState = FakeEventSource.OPEN;
    source.onopen?.();
    const release = acquireCollabPollBoost();
    const before = polls;
    await advance(30_000);
    expect(polls - before).toBeLessThanOrEqual(1);
    release();
    unsub();
  });

  it("lapses after the idle ceiling", async () => {
    const unsub = await subscribeRefused();
    const release = acquireCollabPollBoost();
    await advance(3 * 60_000 + 10_000);
    const lapsedAt = polls;
    await advance(30_000);
    expect(polls - lapsedAt).toBeLessThanOrEqual(1);
    release();
    unsub();
  });

  it("keeps boosting past the ceiling while remote events keep arriving", async () => {
    const unsub = await subscribeRefused();
    const release = acquireCollabPollBoost();
    for (let i = 0; i < 100; i++) {
      nextEvents = [{ source: "action", type: "change", version: i + 1 }];
      await advance(2_500);
    }
    const before = polls;
    await advance(30_000);
    expect(polls - before).toBeGreaterThanOrEqual(11);
    release();
    unsub();
  });
  describe("collaborators on different docs of one resource", () => {
    const action = (
      requestSource?: string,
      resourceType: string | null = "design",
    ) => ({
      source: "action",
      type: "change",
      key: "update-design",
      ...(resourceType ? { resourceType, resourceId: "d1" } : {}),
      ...(requestSource ? { requestSource } : {}),
    });

    async function pollsAfterFirstEvent(event: Record<string, unknown>) {
      const unsub = await subscribeRefused();
      // The idle poll that carries the event; no lease is ever held.
      nextEvents = [{ ...event, version: 1 }];
      await advance(70_000);
      const before = polls;
      await advance(30_000);
      const boosted = polls - before;
      unsub();
      return boosted;
    }

    it("polls every 2.5 s once another tab's resource action event arrives, without any lease", async () => {
      expect(
        await pollsAfterFirstEvent(action("other-tab")),
      ).toBeGreaterThanOrEqual(11);
    });

    it("counts an agent's resource action event (no request source) as collaborator activity", async () => {
      expect(await pollsAfterFirstEvent(action())).toBeGreaterThanOrEqual(11);
    });

    it("stays idle for this tab's own action events and for events naming no resource", async () => {
      expect(
        await pollsAfterFirstEvent(action(getBrowserTabId())),
      ).toBeLessThanOrEqual(1);
      expect(
        await pollsAfterFirstEvent(action("other-tab", null)),
      ).toBeLessThanOrEqual(1);
    });

    it("does not treat the history replayed by the first poll as collaborator activity", async () => {
      nextEvents = [{ ...action("other-tab"), version: 1 }];
      const unsub = await subscribeRefused();
      await advance(1_000);
      const before = polls;
      await advance(30_000);
      expect(polls - before).toBeLessThanOrEqual(1);
      unsub();
    });

    it("returns to the idle cadence a minute after the last collaborator event", async () => {
      const unsub = await subscribeRefused();
      nextEvents = [{ ...action("other-tab"), version: 1 }];
      await advance(70_000);
      await advance(70_000);
      const lapsedAt = polls;
      await advance(30_000);
      expect(polls - lapsedAt).toBeLessThanOrEqual(1);
      unsub();
    });
  });
});
