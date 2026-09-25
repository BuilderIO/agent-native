import { _resetSyncTransportRegistryForTests } from "@agent-native/core/client/use-db-sync";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deckListViewState,
  type DeckListViewState,
} from "@/lib/deck-list-loading";

import { DeckProvider, useDecks, type Deck } from "./DeckContext";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(DeckProvider, null, children),
  );
}

const requestString = (value: unknown) =>
  typeof value === "string"
    ? value
    : value instanceof URL
      ? value.toString()
      : value instanceof Request
        ? value.url
        : (JSON.stringify(value) ?? "");

function deck(id: string): Deck {
  return {
    id,
    title: id,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    slides: [{ id: `${id}-s1`, content: "<p>hi</p>" }],
  } as unknown as Deck;
}

function setupFetch() {
  let serverDecks: Deck[] = [];
  let listFailures = 0;
  let listFailureStatus: number | "network" = 503;
  let holdDeckReads = false;
  let failDeckReads = false;
  const pendingDeckReads: (() => void)[] = [];

  const fetchMock = vi.fn((url: string | URL | Request) => {
    const href = requestString(url);

    if (href.includes("/_agent-native/actions/list-decks")) {
      if (listFailures > 0) {
        listFailures -= 1;
        return listFailureStatus === "network"
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve(new Response("", { status: listFailureStatus }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ count: serverDecks.length, decks: serverDecks }),
          { status: 200 },
        ),
      );
    }

    if (href.includes("/_agent-native/actions/get-deck")) {
      const id = new URL(href, "http://localhost").searchParams.get("id");
      const found = serverDecks.find((d) => d.id === id);
      const respond = () =>
        failDeckReads
          ? new Response("", { status: 500 })
          : found
            ? new Response(JSON.stringify(found), { status: 200 })
            : new Response("", { status: 404 });
      if (!holdDeckReads) return Promise.resolve(respond());
      return new Promise<Response>((resolve) => {
        pendingDeckReads.push(() => resolve(respond()));
      });
    }

    return Promise.resolve(new Response("", { status: 200 }));
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    setServerDecks(decks: Deck[]) {
      serverDecks = decks;
    },
    failNextListReads(count: number, status: number | "network" = 503) {
      listFailures = count;
      listFailureStatus = status;
    },
    /** Make every `get-deck` hang so the list/body gap is observable. */
    holdDeckReads() {
      holdDeckReads = true;
    },
    /** Make every `get-deck` fail deterministically (no retry budget spent). */
    failDeckReads() {
      failDeckReads = true;
    },
    pendingDeckReadCount: () => pendingDeckReads.length,
    releaseDeckReads() {
      holdDeckReads = false;
      while (pendingDeckReads.length > 0) pendingDeckReads.shift()?.();
    },
  };
}

/**
 * Records every distinct state the deck list would render. The report is about
 * the sequence, not the destination, so the assertion has to see the whole
 * transition list rather than the settled value.
 */
function renderDeckListStates() {
  const seen: DeckListViewState[] = [];
  const hook = renderHook(
    () => {
      const value = useDecks();
      const state = deckListViewState({
        loading: value.loading,
        loadError: value.loadError,
        deckCount: value.decks.length,
      });
      if (seen[seen.length - 1] !== state) seen.push(state);
      return value;
    },
    { wrapper },
  );
  return { ...hook, seen };
}

describe("deck list loading states", () => {
  beforeEach(() => {
    _resetSyncTransportRegistryForTests();
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    _resetSyncTransportRegistryForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it("keeps the initial load pending when a cold first read recovers on retry", async () => {
    const api = setupFetch();
    api.setServerDecks([deck("deck-a"), deck("deck-b")]);
    // Exhaust the shared retry budget, then recover on the bounded follow-up
    // read without rendering either the error or empty state in between.
    api.failNextListReads(4, 503);

    const { result, seen } = renderDeckListStates();
    await waitFor(() => expect(result.current.decks).toHaveLength(2), {
      timeout: 15_000,
    });

    expect(seen).toEqual(["loading", "decks"]);
  }, 20_000);

  it("surfaces the error pane when the bounded initial recovery read also fails", async () => {
    const api = setupFetch();
    api.failNextListReads(100, 500);

    const { seen } = renderDeckListStates();
    await waitFor(() => expect(seen).toContain("error"), { timeout: 10_000 });

    expect(seen).toEqual(["loading", "error"]);
  }, 15_000);

  it("surfaces a repeated deterministic action failure", async () => {
    const api = setupFetch();
    // 500 is what an action's own unhandled throw becomes, so each read fails
    // once without spending the shared transport retry budget.
    api.failNextListReads(2, 500);

    const { seen } = renderDeckListStates();
    await waitFor(() => expect(seen).toContain("error"), { timeout: 10_000 });

    expect(seen.slice(0, 2)).toEqual(["loading", "error"]);
  }, 15_000);

  it("reports the empty state only once the server confirms zero decks", async () => {
    setupFetch();

    const { result, seen } = renderDeckListStates();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(seen).toEqual(["loading", "empty"]);
  });

  it("does not pass through 'no decks yet' while an explicit reload rehydrates", async () => {
    const api = setupFetch();
    api.setServerDecks([deck("deck-a")]);
    api.failNextListReads(4, "network");

    const { result, seen } = renderDeckListStates();
    await waitFor(() => expect(seen).toContain("error"), { timeout: 10_000 });

    api.failNextListReads(0);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() => expect(result.current.decks).toHaveLength(1));

    // React batches every update inside the `act` above, so the intermediate
    // "loading" is not separately observable here. What must hold is that the
    // recovery never renders "no decks yet" on its way to the decks.
    expect(seen).not.toContain("empty");
    expect(seen[seen.length - 1]).toBe("decks");
  }, 15_000);
});

describe("deck list recovery through the fallback poll", () => {
  beforeEach(() => {
    _resetSyncTransportRegistryForTests();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    _resetSyncTransportRegistryForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it("retries a failed home list sooner than the normal poll interval", async () => {
    const api = setupFetch();
    api.setServerDecks([deck("deck-a")]);
    api.failNextListReads(100, 500);

    const { result, seen } = renderDeckListStates();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(seen).toEqual(["loading", "error"]);

    api.failNextListReads(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => expect(result.current.decks).toHaveLength(1));

    expect(seen).not.toContain("empty");
    expect(seen[seen.length - 1]).toBe("decks");
  });

  it("fast-retries a later poll failure and clears it after list reconciliation", async () => {
    const api = setupFetch();
    api.setServerDecks([deck("deck-a")]);

    const { result } = renderDeckListStates();
    await waitFor(() => expect(result.current.decks).toHaveLength(1));

    api.failNextListReads(1, 500);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(result.current.loadError).toBe(true));

    const listCallCount = () =>
      api.fetchMock.mock.calls.filter(([url]) =>
        requestString(url).includes("/_agent-native/actions/list-decks"),
      ).length;
    const failedPollCallCount = listCallCount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => expect(result.current.loadError).toBe(false));
    expect(listCallCount()).toBeGreaterThan(failedPollCallCount);
    expect(result.current.decks).toHaveLength(1);
  });

  it("keeps the error when the list names decks whose bodies cannot be read back", async () => {
    const api = setupFetch();
    api.setServerDecks([deck("deck-a")]);
    api.failNextListReads(10, "network");

    const { result, seen } = renderDeckListStates();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => expect(seen).toContain("error"), { timeout: 15_000 });

    // The light list recovers and names deck-a, but its body never reads back.
    // "The server says you have a deck we could not load" must not resolve to
    // "you have no decks".
    api.failNextListReads(0);
    api.failDeckReads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(result.current.decks).toHaveLength(0);
    expect(seen).not.toContain("empty");
    expect(seen[seen.length - 1]).toBe("error");
  });

  it("holds the error pane until recovered decks are applied, never showing the empty state", async () => {
    const api = setupFetch();
    api.setServerDecks([deck("deck-a")]);
    api.failNextListReads(10, "network");

    const { result, seen } = renderDeckListStates();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => expect(seen).toContain("error"), { timeout: 15_000 });
    expect(seen).toEqual(["loading", "error"]);

    // The poll's light list read now succeeds, but the deck bodies it has to
    // fetch are still in flight. That window is where "no decks yet" used to
    // render over a user who has decks.
    api.holdDeckReads();
    api.failNextListReads(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(api.pendingDeckReadCount()).toBeGreaterThan(0), {
      timeout: 15_000,
    });

    expect(seen).not.toContain("empty");

    await act(async () => {
      api.releaseDeckReads();
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(result.current.decks).toHaveLength(1));

    expect(seen.filter((state) => state === "empty")).toEqual([]);
    expect(seen[seen.length - 1]).toBe("decks");
  });
});
