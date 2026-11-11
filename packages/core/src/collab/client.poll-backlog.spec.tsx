// @vitest-environment happy-dom

/**
 * The collab doc's own poll reads the same change feed as the shared
 * transport (see use-db-sync.backlog.spec.ts): while the server says more
 * is waiting past a page that moved the cursor, it reads the next page at
 * once, up to MAX_BACKLOG_PAGES in a row, and only while visible. Presence
 * still rides every page: a slow backlog must not let a still user's
 * 30-second presence row lapse.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as dbSync from "../client/use-db-sync.js";
import {
  _resetSyncTransportRegistryForTests,
  MAX_BACKLOG_PAGES,
} from "../client/use-db-sync.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
} from "./client.js";

const PAGES = 6;
// useCollaborativeDoc's default poll interval.
const INTERVAL_MS = 2_000;

/**
 * A change feed `pages` pages deep, one cursor step per page. `stuck`
 * answers every poll with a limited page that doesn't move, as a read held
 * at an access check does. `failAt` makes that poll fail as a dropped
 * request does.
 */
function backlogFetch(pages = PAGES, { stuck = false, failAt = 0 } = {}) {
  const counts = { polls: 0, awareness: 0 };
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (/\/collab\/[^/]+\/state/.test(url.pathname)) {
      return new Response(
        JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
      );
    }
    if (url.pathname.endsWith("/_agent-native/poll")) {
      counts.polls += 1;
      if (counts.polls === failAt) throw new TypeError("Failed to fetch");
      const cursor = url.searchParams.get("cursor");
      const from = cursor
        ? Number(cursor.split(".")[0])
        : Number(url.searchParams.get("since") ?? 0);
      if (stuck) {
        return new Response(
          JSON.stringify({ version: from, events: [], cursorLimited: true }),
        );
      }
      if (from >= pages) {
        return new Response(JSON.stringify({ version: from, events: [] }));
      }
      const page = from + 1;
      return new Response(
        JSON.stringify({
          version: page,
          cursor: `${page}.r${page}`,
          events: [],
          ...(page < pages ? { cursorLimited: true } : {}),
        }),
      );
    }
    if (url.pathname.endsWith("/awareness")) {
      counts.awareness += 1;
      return new Response(JSON.stringify({ states: [] }));
    }
    return new Response(JSON.stringify({}));
  });
  return { mock, counts };
}

function Probe({
  docId,
  pauseWhenHidden,
}: {
  docId: string;
  pauseWhenHidden?: boolean;
}) {
  useCollaborativeDoc({
    docId,
    user: { name: "Ada", email: "ada@example.com", color: "#123456" },
    pauseWhenHidden,
  });
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("collab poll reading a change-feed backlog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    // Only the doc's own poll loop: the shared transport reads the same feed.
    vi.spyOn(dbSync, "subscribeSyncEvents").mockReturnValue(() => {});
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    delete (document as { visibilityState?: unknown }).visibilityState;
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function render(
    mock: ReturnType<typeof backlogFetch>["mock"],
    pauseWhenHidden?: boolean,
  ) {
    vi.stubGlobal("fetch", mock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <Probe docId="poll-backlog-doc" pauseWhenHidden={pauseWhenHidden} />,
      ),
    );
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("reads every page back to back and renews presence on each", async () => {
    const { mock, counts } = backlogFetch();
    render(mock);

    await advance(200);
    expect(counts.polls).toBe(PAGES);
    expect(counts.awareness).toBe(PAGES);

    // Caught up: one page per interval again.
    await advance(1_500);
    expect(counts.polls).toBe(PAGES);
  });

  it("waits one interval after MAX_BACKLOG_PAGES pages", async () => {
    const { mock, counts } = backlogFetch(Number.MAX_SAFE_INTEGER);
    render(mock);
    const run = MAX_BACKLOG_PAGES + 1;

    await advance(200);
    expect(counts.polls).toBe(run);
    await advance(INTERVAL_MS - 400);
    expect(counts.polls).toBe(run);
    await advance(400);
    expect(counts.polls).toBe(run * 2);
  });

  it("starts a full run after a failed page", async () => {
    const { mock, counts } = backlogFetch(Number.MAX_SAFE_INTEGER, {
      failAt: 5,
    });
    render(mock);

    await advance(200);
    expect(counts.polls).toBe(5);
    // The retry comes after the error backoff (at most 1,250ms) and reads a
    // whole run, not the four pages the failed one had left.
    await advance(1_500);
    expect(counts.polls).toBe(5 + MAX_BACKLOG_PAGES + 1);
  });

  it("waits its interval when a limited page didn't move the cursor", async () => {
    const { mock, counts } = backlogFetch(0, { stuck: true });
    render(mock);

    await advance(200);
    expect(counts.polls).toBe(1);
    await advance(INTERVAL_MS);
    expect(counts.polls).toBe(2);
  });

  it("reads one page per interval while hidden and the rest once visible", async () => {
    setVisibility("hidden");
    const { mock, counts } = backlogFetch();
    render(mock, false);

    await advance(200);
    expect(counts.polls).toBe(1);
    await advance(INTERVAL_MS);
    expect(counts.polls).toBe(2);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(200);
    expect(counts.polls).toBe(PAGES);
  });
});
