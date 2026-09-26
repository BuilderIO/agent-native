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

function deckCallIds(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls
    .map(([url]) => requestString(url))
    .filter((href) => href.includes("/_agent-native/actions/get-deck"))
    .map((href) => new URL(href, "http://localhost").searchParams.get("id"));
}

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

    api.holdNextList();
    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
      source.simulateOpen();
    });
    await waitFor(() => expect(api.listRequestPending()).toBe(true));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Fresh Deck").id;
    });
    api.setServerDecks([result.current.getDeck(deckId)!]);
    await act(async () => {
      api.resolveCreate(new Response("", { status: 200 }));
      await Promise.resolve();
    });

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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("EventSource", MockEventSource);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
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

    expect(deckCallCount(api.fetchMock) - deckBefore).toBeLessThanOrEqual(2);
    expect(listCallCount(api.fetchMock) - listBefore).toBeLessThanOrEqual(2);
  });

  it("keeps the idle poll cadence when SSE reports poll-live instead of connected, without extra churn", async () => {
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
    await act(async () => {
      source.simulateFatalError();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(listCallCount(api.fetchMock)).toBe(listBeforeNotify);
    expect(deckCallCount(api.fetchMock)).toBe(deckBeforeNotify);

    const listBefore = listCallCount(api.fetchMock);
    const deckBefore = deckCallCount(api.fetchMock);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(deckCallCount(api.fetchMock) - deckBefore).toBeLessThanOrEqual(2);
    expect(listCallCount(api.fetchMock) - listBefore).toBeLessThanOrEqual(2);
  });

  it("does not re-fetch unchanged decks on repeated list-decks polls", async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(130_000);
    });

    expect(listCallCount(api.fetchMock) - listBefore).toBeGreaterThanOrEqual(2);
    const idsFetched = deckCallIds(api.fetchMock).slice(deckBefore);
    expect(idsFetched.filter((id) => id !== decks[0].id)).toEqual([]);
  });

  it("coalesces a sync-event batch into one get-deck for the open deck, not one per changed deck", async () => {
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
    expect(listCallCount(api.fetchMock)).toBe(listBefore);
  });

  it("coalesces a sync-event batch into one list refresh when no deck is open, and updates a known deck's title", async () => {
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

    expect(listCallCount(api.fetchMock) - listBefore).toBe(1);
    expect(deckCallCount(api.fetchMock)).toBe(deckBefore);
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(deckCallCount(api.fetchMock) - deckBefore).toBeGreaterThanOrEqual(2);
  });

  it("keeps reconciling the open deck while the tab is hidden", async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(listCallCount(api.fetchMock)).toBe(listAfterWrite);
  });

  it("requests the preview projection only on the grid, and the id-only listing while a deck is open", async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const savedDeck = result.current.getDeck("open-deck");
    expect(savedDeck?.title).toBe("Renamed locally");
    api.setServerDecks([savedDeck!]);

    await act(async () => {
      api.releaseList([deck]);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.getDeck("open-deck")?.title).toBe("Renamed locally");
  });

  it("catches up the deck list once the grid reports a batch of decks changed while another deck was open", async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      window.history.pushState({}, "", "/");
      result.current.catchUpStaleDeckList();
    });
    await waitFor(() =>
      expect(listCallCount(api.fetchMock)).toBe(listBefore + 1),
    );
  });
});
