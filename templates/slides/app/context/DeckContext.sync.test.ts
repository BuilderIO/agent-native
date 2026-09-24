import { _resetSyncTransportRegistryForTests } from "@agent-native/core/client/use-db-sync";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
const requestString = (value: unknown) =>
  typeof value === "string"
    ? value
    : value instanceof URL
      ? value.toString()
      : value instanceof Request
        ? value.url
        : (JSON.stringify(value) ?? "");
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orgQueryState = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => orgQueryState,
}));

import { DeckProvider, useDecks, type Deck } from "./DeckContext";

class MockEventSource {
  static lastInstance: MockEventSource | null = null;
  static instances: MockEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState: number = MockEventSource.CONNECTING;
  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(public url: string) {
    MockEventSource.lastInstance = this;
    MockEventSource.instances.push(this);
  }

  simulateOpen() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  simulateFatalError() {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.(new Event("error"));
  }
}

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

function setupFetch() {
  let serverDecks: Deck[] = [];
  let resolveCreate: (response: Response) => void = () => {};
  let heldListRequestBudget = 0;
  const pendingListResolves: Array<(response: Response) => void> = [];

  const listResponse = (decks: Deck[]) =>
    new Response(JSON.stringify({ count: decks.length, decks }), {
      status: 200,
    });

  const fetchMock = vi.fn((url: string | URL | Request) => {
    const href =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

    if (href.includes("/_agent-native/actions/list-decks")) {
      if (heldListRequestBudget > 0) {
        heldListRequestBudget -= 1;
        return new Promise<Response>((resolve) => {
          pendingListResolves.push(resolve);
        });
      }
      return Promise.resolve(listResponse(serverDecks));
    }

    if (href.includes("/_agent-native/actions/add-deck")) {
      return new Promise<Response>((resolve) => {
        resolveCreate = resolve;
      });
    }

    if (href.includes("/_agent-native/actions/get-deck")) {
      const id = new URL(href, "http://localhost").searchParams.get("id");
      const found = serverDecks.find((d) => d.id === id);
      return Promise.resolve(
        found
          ? new Response(JSON.stringify(found), { status: 200 })
          : new Response("", { status: 404 }),
      );
    }

    return Promise.resolve(new Response("", { status: 200 }));
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    setServerDecks: (decks: Deck[]) => {
      serverDecks = decks;
    },
    resolveCreate: (response: Response) => resolveCreate(response),
    /** Make the next list-decks request hang until `releaseList` is called. */
    holdNextList: () => {
      heldListRequestBudget += 1;
    },
    listRequestPending: () => pendingListResolves.length > 0,
    pendingListCount: () => pendingListResolves.length,
    releaseList: (decks: Deck[]) => {
      pendingListResolves.shift()?.(listResponse(decks));
    },
  };
}

function listCallCount(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls.filter(([url]) =>
    requestString(url).includes("/_agent-native/actions/list-decks"),
  ).length;
}

/** The full request URL of every list-decks call, in call order. */
function listCallUrls(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls
    .map(([url]) => requestString(url))
    .filter((href) => href.includes("/_agent-native/actions/list-decks"));
}

function deckCallCount(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls.filter(([url]) =>
    requestString(url).includes("/_agent-native/actions/get-deck"),
  ).length;
}

/** The `id` search param of every get-deck call, in call order. */
function deckCallIds(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls
    .map(([url]) => requestString(url))
    .filter((href) => href.includes("/_agent-native/actions/get-deck"))
    .map((href) => new URL(href, "http://localhost").searchParams.get("id"));
}

/**
 * happy-dom reports a `visible` document and offers no way to background it.
 * Backgrounded is the state an external agent always drives the editor in, so
 * the poll's behavior there has to be assertable.
 */
let restoreVisibility: (() => void) | null = null;
function hideDocument() {
  const original = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "visibilityState",
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  restoreVisibility = () => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
    if (original && !("visibilityState" in document)) {
      Object.defineProperty(Document.prototype, "visibilityState", original);
    }
  };
}

async function lastEventSource(): Promise<MockEventSource> {
  await waitFor(() => expect(MockEventSource.lastInstance).not.toBeNull());
  return MockEventSource.lastInstance!;
}

describe("DeckContext optimistic create", () => {
  beforeEach(() => {
    _resetSyncTransportRegistryForTests();
    orgQueryState.data = undefined;
    orgQueryState.isLoading = false;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    orgQueryState.data = undefined;
    orgQueryState.isLoading = false;
    _resetSyncTransportRegistryForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    queryClient.clear();
    MockEventSource.lastInstance = null;
    MockEventSource.instances = [];
  });

  it("keeps a newly created deck when a list snapshot taken before the create resolves after it", async () => {
    window.history.pushState({}, "", "/");
    const api = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.decks).toEqual([]);

    // A list refresh starts while the user still has zero decks (here via the
    // SSE reconnect resync; the fallback poll issues the same request).
    api.holdNextList();
    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
      source.simulateOpen();
    });
    await waitFor(() => expect(api.listRequestPending()).toBe(true));

    // User creates a deck while that request is still in flight, and the
    // create succeeds server-side.
    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Fresh Deck").id;
    });
    api.setServerDecks([result.current.getDeck(deckId)!]);
    await act(async () => {
      api.resolveCreate(new Response("", { status: 200 }));
      await Promise.resolve();
    });

    // The in-flight snapshot predates the create, so it cannot prove the deck
    // is absent. Resolving it must not wipe the deck back to the empty state.
    await act(async () => {
      api.releaseList([]);
      await Promise.resolve();
    });

    expect(result.current.getDeck(deckId)?.title).toBe("Fresh Deck");
    expect(result.current.decks).toHaveLength(1);
  });

  it("keeps a newly created deck when a baseline reload snapshot predates the create", async () => {
    window.history.pushState({}, "", "/");
    const api = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Baseline reloads replace `decks` wholesale, so they need the same
    // protection as the poll path when the active organization is unchanged.
    api.holdNextList();
    let reload: Promise<void> = Promise.resolve();
    act(() => {
      reload = result.current.reloadDecks();
    });
    await waitFor(() => expect(api.listRequestPending()).toBe(true));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Reload Race Deck").id;
    });
    api.setServerDecks([result.current.getDeck(deckId)!]);
    await act(async () => {
      api.resolveCreate(new Response("", { status: 200 }));
      await Promise.resolve();
    });

    await act(async () => {
      api.releaseList([]);
      await reload;
    });

    expect(result.current.getDeck(deckId)?.title).toBe("Reload Race Deck");
    expect(result.current.decks).toHaveLength(1);
  });

  it("clears previous-organization decks before loading the next organization", async () => {
    window.history.pushState({}, "", "/");
    orgQueryState.data = { orgId: "org-a" };
    const api = setupFetch();
    const { result, rerender } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let previousDeckId = "";
    act(() => {
      previousDeckId = result.current.createDeck("Previous Org Deck").id;
    });
    api.setServerDecks([result.current.getDeck(previousDeckId)!]);
    await act(async () => {
      api.resolveCreate(new Response("", { status: 200 }));
      await Promise.resolve();
    });
    const previousOrgDeck = result.current.getDeck(previousDeckId)!;
    window.history.pushState({}, "", `/deck/${previousDeckId}`);

    const currentOrgDeck: Deck = {
      id: "current-org-deck",
      title: "Current Org Deck",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
      slides: [],
    };
    api.holdNextList();
    let previousOrgReload: Promise<void> = Promise.resolve();
    act(() => {
      previousOrgReload = result.current.reloadDecks();
    });
    await waitFor(() => expect(api.pendingListCount()).toBe(1));

    api.holdNextList();
    api.setServerDecks([currentOrgDeck]);
    act(() => {
      orgQueryState.data = { orgId: "org-b" };
      rerender();
    });

    await waitFor(() => expect(api.pendingListCount()).toBe(2));
    expect(result.current.decks).toEqual([]);
    expect(window.location.pathname).toBe("/home");

    await act(async () => {
      api.releaseList([previousOrgDeck]);
      await previousOrgReload;
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.decks).toEqual([]);

    await act(async () => {
      api.releaseList([currentOrgDeck]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.decks.map((deck) => deck.id)).toEqual([
      currentOrgDeck.id,
    ]);
    expect(result.current.getDeck(previousDeckId)).toBeUndefined();
  });
});

describe("DeckContext fallback polling", () => {
  beforeEach(() => {
    _resetSyncTransportRegistryForTests();
    // Fake timers must be installed BEFORE the provider mounts, otherwise the
    // poll's first setTimeout is a real timer that advanceTimersByTime cannot
    // move. `shouldAdvanceTime` keeps `waitFor` usable.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("EventSource", MockEventSource);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    // Unmount before restoring timers: a provider left mounted keeps its poll
    // loop running and inflates the request counts a later test asserts on.
    cleanup();
    restoreVisibility?.();
    restoreVisibility = null;
    _resetSyncTransportRegistryForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    queryClient.clear();
    MockEventSource.lastInstance = null;
    MockEventSource.instances = [];
  });

  it("backs off the open-deck poll while the live channel is connected", async () => {
    const deck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", "/deck/open-deck");
    const api = setupFetch();
    api.setServerDecks([deck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });

    const listBefore = listCallCount(api.fetchMock);
    const deckBefore = deckCallCount(api.fetchMock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // One idle minute on a healthy SSE connection used to cost ~12 get-deck
    // fetches from the unconditional 5s "fallback" poll.
    expect(deckCallCount(api.fetchMock) - deckBefore).toBeLessThanOrEqual(2);
    expect(listCallCount(api.fetchMock) - listBefore).toBeLessThanOrEqual(2);
  });

  it("keeps the idle poll cadence when SSE reports poll-live instead of connected, without extra churn", async () => {
    // A serverless deploy always refuses the SSE connection (the app-origin
    // stream 204s before ever opening): the transport reports
    // `connected: false` with a `poll-live` capability, meaning /poll is
    // already the live channel and the idle cadence is safe, not "live
    // channel genuinely down".
    const deck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", "/deck/open-deck");
    const api = setupFetch();
    api.setServerDecks([deck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    const deckBeforeNotify = deckCallCount(api.fetchMock);
    const listBeforeNotify = listCallCount(api.fetchMock);
    // Never opened (no simulateOpen()) before it fails — the "refused
    // outright" path, not a genuine connect/disconnect transition.
    await act(async () => {
      source.simulateFatalError();
      // A pollNow-driven poll issues list-decks first and only calls
      // get-deck once that await resolves, so the deck-call assertion right
      // after a synchronous act() can't see a wrongly-triggered fetch yet —
      // flush the microtask queue before asserting either count.
      await vi.advanceTimersByTimeAsync(0);
    });

    // A poll-live notification is not a disconnect: it must not itself
    // trigger a resync/pollNow-driven fetch the way losing an actually
    // -connected channel does.
    expect(listCallCount(api.fetchMock)).toBe(listBeforeNotify);
    expect(deckCallCount(api.fetchMock)).toBe(deckBeforeNotify);

    const listBefore = listCallCount(api.fetchMock);
    const deckBefore = deckCallCount(api.fetchMock);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // Same idle cadence a genuinely connected live channel gets — not the
    // fast 5s/15s fallback a "live channel down" state would use.
    expect(deckCallCount(api.fetchMock) - deckBefore).toBeLessThanOrEqual(2);
    expect(listCallCount(api.fetchMock) - listBefore).toBeLessThanOrEqual(2);
  });

  it("does not re-fetch unchanged decks on repeated list-decks polls", async () => {
    // Regression guard for the N+1 fan-out this poll used to have: every
    // `refetchDeckListIfChanged` tick used to hydrate every deck's full body
    // just to diff ids, so an account with many decks paid for a full
    // get-deck fan-out every ~15s. `addedIds` (DeckContext.tsx) now diffs the
    // light listing against locally-known ids, so only a genuinely new deck
    // should ever trigger a follow-up get-deck.
    const decks: Deck[] = Array.from({ length: 24 }, (_, i) => ({
      id: `deck-${i}`,
      title: `Deck ${i}`,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    }));
    window.history.pushState({}, "", `/deck/${decks[0].id}`);
    const api = setupFetch();
    api.setServerDecks(decks);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });

    const listBefore = listCallCount(api.fetchMock);
    const deckBefore = deckCallCount(api.fetchMock);

    // Two full idle (SSE-connected, 60s) poll windows, none of which add or
    // remove a deck server-side. A little over 2 minutes, not exactly: the
    // very first tick after connecting can still land on the pre-connect 5s
    // open-deck cadence and skip the list gate that tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130_000);
    });

    // The list poll actually ran in this window...
    expect(listCallCount(api.fetchMock) - listBefore).toBeGreaterThanOrEqual(2);
    // ...and every get-deck call it produced was the open deck's own
    // reconcile — the other 23 unchanged decks were never individually
    // re-fetched.
    const idsFetched = deckCallIds(api.fetchMock).slice(deckBefore);
    expect(idsFetched.filter((id) => id !== decks[0].id)).toEqual([]);
  });

  it("coalesces a sync-event batch into one get-deck for the open deck, not one per changed deck", async () => {
    // The core poll delivers every org deck's change event to every org
    // member, batched on the SSE/fallback delivery. A tab presenting one
    // deck used to fetch every deck anyone in the org touched that minute,
    // once per event — a beta session saw 15-50 get-deck calls per burst
    // this way. Only the deck this tab actually has open may be re-fetched.
    const openDeck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", `/deck/${openDeck.id}`);
    const api = setupFetch();
    api.setServerDecks([openDeck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });

    const listBefore = listCallCount(api.fetchMock);
    const deckBefore = deckCallCount(api.fetchMock);

    const batch = [
      ...Array.from({ length: 3 }, () => ({
        source: "deck",
        type: "deck-changed",
        deckId: openDeck.id,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        source: "deck",
        type: "deck-changed",
        deckId: `other-deck-${i}`,
      })),
    ];

    await act(async () => {
      source.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ events: batch }),
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(deckCallCount(api.fetchMock) - deckBefore).toBe(1);
    expect(deckCallIds(api.fetchMock).at(-1)).toBe(openDeck.id);
    // The other 20 changed decks aren't rendered here (a deck is open, not
    // the home grid) and must not fall back to a list refresh either.
    expect(listCallCount(api.fetchMock)).toBe(listBefore);
  });

  it("coalesces a sync-event batch into one list refresh when no deck is open, and updates a known deck's title", async () => {
    // MAJOR regression guard: the coalesced batch used to only diff added/
    // removed ids (refetchDeckListIfChanged), so a rename or first-slide
    // edit to a deck already on the grid never refreshed its card — the
    // event was seen but silently had nothing to do with it. DeckCard
    // renders deck.title and deck.previewSlide, so the merge has to reach
    // those fields, not just membership.
    const knownDeck: Deck = {
      id: "known-deck",
      title: "Original Title",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", "/");
    const api = setupFetch();
    api.setServerDecks([knownDeck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.decks).toHaveLength(1));

    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });

    const listBefore = listCallCount(api.fetchMock);
    const deckBefore = deckCallCount(api.fetchMock);

    // Renamed server-side (e.g. by the agent or a teammate) in the same
    // batch that also reports unrelated changed decks.
    api.setServerDecks([
      {
        ...knownDeck,
        title: "Renamed Elsewhere",
        updatedAt: "2026-07-25T00:01:00.000Z",
      },
    ]);
    const batch = [
      { source: "deck", type: "deck-changed", deckId: knownDeck.id },
      ...Array.from({ length: 9 }, (_, i) => ({
        source: "deck",
        type: "deck-changed",
        deckId: `other-deck-${i}`,
      })),
    ];

    await act(async () => {
      source.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ events: batch }),
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    // One light+preview list diff for the whole batch, no per-deck get-deck
    // fetch...
    expect(listCallCount(api.fetchMock) - listBefore).toBe(1);
    expect(deckCallCount(api.fetchMock)).toBe(deckBefore);
    // ...and the known deck's card actually picks up the new title instead
    // of staying stuck on the pre-regression snapshot.
    await waitFor(() =>
      expect(result.current.getDeck(knownDeck.id)?.title).toBe(
        "Renamed Elsewhere",
      ),
    );
  });

  it("takes over at the fast interval when the live channel drops", async () => {
    const deck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", "/deck/open-deck");
    const api = setupFetch();
    api.setServerDecks([deck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const deckBefore = deckCallCount(api.fetchMock);

    act(() => {
      source.simulateFatalError();
    });
    // Losing the live channel must resume fast polling immediately rather than
    // waiting out the idle interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(deckCallCount(api.fetchMock) - deckBefore).toBeGreaterThanOrEqual(2);
  });

  it("keeps reconciling the open deck while the tab is hidden", async () => {
    // An external agent (MCP / WebMCP / CDP) writes into a tab nobody is
    // looking at. Skipping the poll while hidden left an agent's add-slide
    // unseen for 33s on beta — the write had landed, the editor never asked.
    const deck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", "/deck/open-deck");
    const api = setupFetch();
    api.setServerDecks([deck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const deckBefore = deckCallCount(api.fetchMock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(deckCallCount(api.fetchMock) - deckBefore).toBeGreaterThanOrEqual(2);
  });

  it("reads the deck back when a page-local WebMCP write announces itself", async () => {
    // The WebMCP bridge dispatches `agentNative:refresh-data` after every
    // mutating page-local call. On beta an add-slide called through
    // `window.__agentNativeWebMcp` in a hidden tab returned ok and the new
    // slide was still missing 152s later: the writing tab was waiting out the
    // 60s SSE fallback interval and nothing here listened for the write.
    const deck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", "/deck/open-deck");
    const api = setupFetch();
    api.setServerDecks([deck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });
    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const deckBefore = deckCallCount(api.fetchMock);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(deckCallCount(api.fetchMock)).toBeGreaterThan(deckBefore);
  });

  it("adopts the agent-added slide's own content, not a sibling's", async () => {
    // beta.slides: an external agent called add-slide through
    // `window.__agentNativeWebMcp` in a hidden tab. The refetch fired and the
    // sidebar gained a second thumbnail, but slide 2 rendered slide 1's body
    // — a wrong slide, not a slow one.
    const deck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: '<div class="fmd-slide">Final check</div>',
          notes: "",
          layout: "content",
        },
      ],
    };
    window.history.pushState({}, "", "/deck/open-deck");
    const api = setupFetch();
    api.setServerDecks([deck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });
    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    api.setServerDecks([
      {
        ...deck,
        updatedAt: "2026-07-25T00:01:00.000Z",
        slides: [
          deck.slides[0]!,
          {
            id: "slide-2",
            content: '<div class="fmd-slide">Hidden tab slide ZQX</div>',
            notes: "",
            layout: "content",
          },
        ],
      },
    ]);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() =>
      expect(result.current.getDeck("open-deck")?.slides).toHaveLength(2),
    );
    const slides = result.current.getDeck("open-deck")!.slides;
    expect(slides[1]!.id).toBe("slide-2");
    expect(slides[1]!.content).toContain("Hidden tab slide ZQX");
    expect(slides[0]!.content).toContain("Final check");
  });

  it("stops polling a hidden tab that has no deck open", async () => {
    window.history.pushState({}, "", "/");
    const api = setupFetch();
    api.setServerDecks([]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const listBefore = listCallCount(api.fetchMock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(listCallCount(api.fetchMock)).toBe(listBefore);
  });

  it("still reads once on an announced write in a hidden tab with no deck open", async () => {
    window.history.pushState({}, "", "/");
    const api = setupFetch();
    api.setServerDecks([]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const listBefore = listCallCount(api.fetchMock);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
      await vi.advanceTimersByTimeAsync(0);
    });
    const listAfterWrite = listCallCount(api.fetchMock);
    expect(listAfterWrite).toBeGreaterThan(listBefore);

    // One read, not a resumed poll loop: the idle gate is skipped for the
    // announced write only.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(listCallCount(api.fetchMock)).toBe(listAfterWrite);
  });

  it("requests the preview projection only on the grid, and the id-only listing while a deck is open", async () => {
    // MAJOR regression guard: merging previewSlide into a fully loaded open
    // deck (get-deck never returns it) made every idle poll look like a
    // content change and reconcile a no-op "Agent edit" over the open deck.
    // The fix scopes `includePreview` to whichever listing mode is actually
    // rendered, so this asserts the request shape directly instead of the
    // downstream undo/reconcile behavior. Uses the SSE resync (two `open`
    // transitions) to trigger `refetchDeckListIfChanged` deterministically,
    // rather than racing the fallback poll's own timing.
    const openDeck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", `/deck/${openDeck.id}`);
    const api = setupFetch();
    api.setServerDecks([openDeck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    const listBefore = listCallUrls(api.fetchMock).length;
    await act(async () => {
      source.simulateOpen();
      source.simulateOpen();
      await vi.advanceTimersByTimeAsync(0);
    });
    const openDeckListCalls = listCallUrls(api.fetchMock).slice(listBefore);
    expect(openDeckListCalls.length).toBeGreaterThan(0);
    expect(
      openDeckListCalls.every((url) => !url.includes("includePreview")),
    ).toBe(true);

    // A change to another deck while this one is open, so the grid's
    // catch-up has something to fetch once the user returns to it.
    await act(async () => {
      source.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            events: [
              { source: "deck", type: "deck-changed", deckId: "other-deck" },
            ],
          }),
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    const listBeforeGrid = listCallUrls(api.fetchMock).length;
    act(() => {
      window.history.pushState({}, "", "/");
      result.current.catchUpStaleDeckList();
    });
    await waitFor(() =>
      expect(listCallUrls(api.fetchMock).length).toBeGreaterThan(
        listBeforeGrid,
      ),
    );
    const gridListCalls = listCallUrls(api.fetchMock).slice(listBeforeGrid);
    expect(gridListCalls.some((url) => url.includes("includePreview"))).toBe(
      true,
    );
  });

  it("does not let a stale list snapshot clobber a rename that finished saving while the poll was in flight", async () => {
    // MAJOR regression guard: the dirty-drain effect removes a deck from
    // `dirtyDeckIdsRef` on the render right after `updateDeck`, and the write
    // can enqueue, debounce, flush, and drain entirely before an in-flight
    // list poll's response lands — leaving nothing in any pending map by the
    // time it does. Guarding only on `dirtyDeckIdsRef` let that stale
    // snapshot revert the rename.
    const deck: Deck = {
      id: "open-deck",
      title: "Original",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [{ id: "s1", content: "<p>hi</p>" }],
    } as unknown as Deck;
    window.history.pushState({}, "", "/deck/open-deck");
    const api = setupFetch();
    api.setServerDecks([deck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    api.holdNextList();
    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
      source.simulateOpen();
    });
    await waitFor(() => expect(api.listRequestPending()).toBe(true));

    act(() => {
      result.current.updateDeck("open-deck", { title: "Renamed locally" });
    });

    // The debounced save (500ms) drains and completes while the stale list
    // request is still held, clearing pendingOpsQueue/pendingSaves and
    // dirtyDeckIdsRef entirely. Mirror the rename into `serverDecks` too, the
    // way a real PATCH would — get-deck (used by the resync's open-deck
    // reconcile, a separate path from the one under test) must see the same
    // save the client just made, or it reverts the title on its own for a
    // reason unrelated to the list-snapshot guard this test targets.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const savedDeck = result.current.getDeck("open-deck");
    expect(savedDeck?.title).toBe("Renamed locally");
    api.setServerDecks([savedDeck!]);

    // The held list request predates the rename (still "Original"); resolving
    // it now must not revert the title.
    await act(async () => {
      api.releaseList([deck]);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.getDeck("open-deck")?.title).toBe("Renamed locally");
  });

  it("catches up the deck list once the grid reports a batch of decks changed while another deck was open", async () => {
    // MAJOR regression guard for the in-app-navigation gap: the fallback
    // poll's `popstate` listener only catches the browser back/forward
    // buttons, so a deck-changed event stashed in `staleDeckIdsRef` while
    // this tab had a different deck open needs `catchUpStaleDeckList` (what
    // the grid page calls on mount) to actually flush it.
    const openDeck: Deck = {
      id: "open-deck",
      title: "Open Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    const otherDeck: Deck = {
      id: "other-deck",
      title: "Other Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    window.history.pushState({}, "", `/deck/${openDeck.id}`);
    const api = setupFetch();
    api.setServerDecks([openDeck, otherDeck]);
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });
    const listBefore = listCallCount(api.fetchMock);

    // A change to `other-deck` arrives while `open-deck` is the only one
    // rendered here — stashed, not fetched individually.
    await act(async () => {
      source.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            events: [
              { source: "deck", type: "deck-changed", deckId: otherDeck.id },
            ],
          }),
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listCallCount(api.fetchMock)).toBe(listBefore);

    // Nothing left over from a scheduled poll should confuse the assertion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The user navigates back to the grid; its mount effect calls this.
    act(() => {
      window.history.pushState({}, "", "/");
      result.current.catchUpStaleDeckList();
    });
    await waitFor(() =>
      expect(listCallCount(api.fetchMock)).toBe(listBefore + 1),
    );
  });
});
