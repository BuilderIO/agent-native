// @vitest-environment happy-dom

/**
 * The collab doc's own poll reads the same change feed as the shared
 * transport (see use-db-sync.backlog.spec.ts): while the server says more
 * is waiting past a page that moved the cursor, it reads the next page at
 * once. Presence still rides every page: a slow backlog must not let a still
 * user's 30-second presence row lapse.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as dbSync from "../client/use-db-sync.js";
import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
} from "./client.js";

const PAGES = 6;

function backlogFetch() {
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
      const cursor = url.searchParams.get("cursor");
      const from = cursor
        ? Number(cursor.split(".")[0])
        : Number(url.searchParams.get("since") ?? 0);
      if (from >= PAGES) {
        return new Response(JSON.stringify({ version: from, events: [] }));
      }
      const page = from + 1;
      return new Response(
        JSON.stringify({
          version: page,
          cursor: `${page}.r${page}`,
          events: [],
          ...(page < PAGES ? { cursorLimited: true } : {}),
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

function Probe({ docId }: { docId: string }) {
  useCollaborativeDoc({
    docId,
    user: { name: "Ada", email: "ada@example.com", color: "#123456" },
  });
  return null;
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
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads every page back to back and renews presence on each", async () => {
    const { mock, counts } = backlogFetch();
    vi.stubGlobal("fetch", mock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe docId="poll-backlog-doc" />));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(counts.polls).toBe(PAGES);
    expect(counts.awareness).toBe(PAGES);

    // Caught up: one page per interval again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(counts.polls).toBe(PAGES);
  });
});
