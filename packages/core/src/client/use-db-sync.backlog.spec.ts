// @vitest-environment happy-dom

/**
 * A poll reads at most 1,000 change rows, other accounts' included, and says
 * `cursorLimited` when it stopped short of the newest. A tab that waited its
 * interval between pages fell minutes behind a burst, and every empty page
 * grew its idle backoff, so it slowed down while behind. These pin the drain:
 * read the next page at once while the server says more is waiting and the
 * cursor moved, up to MAX_BACKLOG_PAGES in a row, and only while visible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSyncTransportRegistryForTests,
  MAX_BACKLOG_PAGES,
  subscribeSyncEvents,
  type SyncEvent,
} from "./use-db-sync";

const INTERVAL_MS = 5_000;

/**
 * A change feed `pages` pages deep. Each page is one cursor step of other
 * accounts' events, so it comes back empty; the last holds the tab's own
 * change. A cursor is `<version>.r<page>`, so with `sharedVersion` every row
 * has one version and only the row id moves. `stuck` answers every poll with
 * a limited page that doesn't move, as a read held at an access check does.
 */
function backlogServer(
  pages: number,
  { stuck = false, sharedVersion = false } = {},
) {
  const server = { polls: 0 };
  const versionOf = (page: number) => (sharedVersion ? 1 : page);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (!url.pathname.endsWith("/_agent-native/poll")) {
        return { ok: true, json: async () => ({}) };
      }
      server.polls += 1;
      if (stuck) {
        return {
          ok: true,
          json: async () => ({
            version: Number(url.searchParams.get("since") ?? 0),
            events: [],
            cursorLimited: true,
          }),
        };
      }
      const from = Number(
        /\.r(\d+)$/.exec(url.searchParams.get("cursor") ?? "")?.[1] ?? 0,
      );
      if (from >= pages) {
        return {
          ok: true,
          json: async () => ({ version: versionOf(from), events: [] }),
        };
      }
      const page = from + 1;
      const version = versionOf(page);
      const events =
        page === pages
          ? [{ source: "action", type: "change", version, cursorId: "own" }]
          : [];
      return {
        ok: true,
        json: async () => ({
          version,
          cursor: `${version}.r${String(page).padStart(4, "0")}`,
          events,
          ...(page < pages ? { cursorLimited: true } : {}),
        }),
      };
    }),
  );
  return server;
}

function subscribe(onEvents: (events: SyncEvent[]) => void = () => {}) {
  return subscribeSyncEvents({
    onEvents,
    sseUrl: false,
    interval: INTERVAL_MS,
    fallbackInterval: INTERVAL_MS,
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("reading a change-feed backlog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetSyncTransportRegistryForTests();
  });

  afterEach(() => {
    _resetSyncTransportRegistryForTests();
    delete (document as { visibilityState?: unknown }).visibilityState;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads every page back to back and delivers the change on the last", async () => {
    const server = backlogServer(6);
    const delivered: SyncEvent[] = [];
    const unsub = subscribe((events) => delivered.push(...events));

    await vi.advanceTimersByTimeAsync(100);
    expect(server.polls).toBe(6);
    expect(delivered.map((event) => event.cursorId)).toEqual(["own"]);

    // Caught up: back to the ordinary cadence.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 200);
    expect(server.polls).toBe(6);
    unsub();
  });

  it("reads pages that share one version by their row ids", async () => {
    const server = backlogServer(6, { sharedVersion: true });
    const delivered: SyncEvent[] = [];
    const unsub = subscribe((events) => delivered.push(...events));

    await vi.advanceTimersByTimeAsync(100);
    expect(server.polls).toBe(6);
    expect(delivered.map((event) => event.cursorId)).toEqual(["own"]);
    unsub();
  });

  it("waits one interval after MAX_BACKLOG_PAGES pages, without growing its idle backoff", async () => {
    const server = backlogServer(Number.MAX_SAFE_INTEGER);
    const unsub = subscribe();
    const run = MAX_BACKLOG_PAGES + 1;

    await vi.advanceTimersByTimeAsync(100);
    expect(server.polls).toBe(run);

    // Empty pages that say more is waiting are not idle ones: every later run
    // starts one base interval after the last, not on a doubled backoff.
    for (let index = 2; index <= 4; index += 1) {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 200);
      expect(server.polls).toBe(run * (index - 1));
      await vi.advanceTimersByTimeAsync(200);
      expect(server.polls).toBe(run * index);
    }
    unsub();
  });

  it("waits its interval when a limited page didn't move the cursor", async () => {
    const server = backlogServer(0, { stuck: true });
    const unsub = subscribe();

    await vi.advanceTimersByTimeAsync(100);
    expect(server.polls).toBe(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(server.polls).toBe(2);
    unsub();
  });

  it("reads one page per interval while hidden and the rest once visible", async () => {
    setVisibility("hidden");
    const server = backlogServer(6);
    const delivered: SyncEvent[] = [];
    const unsub = subscribe((events) => delivered.push(...events));

    await vi.advanceTimersByTimeAsync(100);
    expect(server.polls).toBe(1);
    // A hidden tab polls at least every 10 seconds.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.polls).toBe(2);
    expect(delivered).toEqual([]);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(100);
    expect(server.polls).toBe(6);
    expect(delivered.map((event) => event.cursorId)).toEqual(["own"]);
    unsub();
  });
});
