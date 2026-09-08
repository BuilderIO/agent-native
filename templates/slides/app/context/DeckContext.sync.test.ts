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
  let holdList: ((decks: Deck[]) => void) | null = null;
  let pendingListResolve: ((response: Response) => void) | null = null;

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
      if (holdList) {
        return new Promise<Response>((resolve) => {
          pendingListResolve = resolve;
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
      holdList = () => {};
    },
    listRequestPending: () => pendingListResolve !== null,
    releaseList: (decks: Deck[]) => {
      const resolve = pendingListResolve;
      pendingListResolve = null;
      holdList = null;
      resolve?.(listResponse(decks));
    },
  };
}

function listCallCount(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls.filter(([url]) =>
    requestString(url).includes("/_agent-native/actions/list-decks"),
  ).length;
}

function deckCallCount(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls.filter(([url]) =>
    requestString(url).includes("/_agent-native/actions/get-deck"),
  ).length;
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
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
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

    // Baseline reloads (mount, route change, org switch) replace `decks`
    // wholesale rather than diffing, so they need the same protection as the
    // poll path — otherwise a create racing the reload is silently erased.
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
});
