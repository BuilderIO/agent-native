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
  data: { orgId: null } as unknown,
  isLoading: false,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => orgQueryState,
}));

import { registerInlineEditRemoteApplier } from "../lib/inline-edit-remote";
import {
  DeckProvider,
  clearSlideEditingActive,
  fallbackPollIntervalMs,
  getDeckSaveError,
  hasFailedDeckSave,
  hasUnsavedDeckChanges,
  markSlideEditingActive,
  useDecks,
  type Deck,
} from "./DeckContext";

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

const wrapper = routedWrapper();

function noRealtimeWrapper({ children }: { children: ReactNode }) {
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(DeckProvider, { children }),
  );
}

function setupFetch() {
  let serverDecks: Deck[] = [];
  let missingDeckDetails = new Set<string>();
  let resolveCreate: (response: Response) => void = () => {};
  let heldListRequestBudget = 0;
  let listFailureStatus: number | null = null;
  let deckFailureStatus: number | null = null;
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
      if (listFailureStatus !== null) {
        return Promise.resolve(new Response("", { status: listFailureStatus }));
      }
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
      if (deckFailureStatus !== null) {
        return Promise.resolve(new Response("", { status: deckFailureStatus }));
      }
      const id = new URL(href, "http://localhost").searchParams.get("id");
      const found = serverDecks.find((d) => d.id === id);
      return Promise.resolve(
        found && !missingDeckDetails.has(id ?? "")
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
    setMissingDeckDetails: (ids: string[]) => {
      missingDeckDetails = new Set(ids);
    },
    failListReads: (status: number | null) => {
      listFailureStatus = status;
    },
    failDeckReads: (status: number | null) => {
      deckFailureStatus = status;
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
    orgQueryState.data = { orgId: null };
    orgQueryState.isLoading = false;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    orgQueryState.data = { orgId: null };
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

  it("preserves a deck deep link when the first organization read resolves", async () => {
    window.history.pushState({}, "", "/deck/deep-linked-deck?slide=1");
    orgQueryState.data = undefined;
    orgQueryState.isLoading = false;
    const api = setupFetch();
    const linkedDeck: Deck = {
      id: "deep-linked-deck",
      title: "Deep-linked Deck",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
      slides: [
        {
          id: "linked-slide",
          content: "<p>Linked slide</p>",
          notes: "",
          layout: "content",
        },
      ],
    };
    api.setServerDecks([linkedDeck]);
    const { result, rerender } = renderHook(() => useDecks(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.decks).toEqual([]);
    expect(
      api.fetchMock.mock.calls.some(([url]) =>
        requestString(url).includes("/_agent-native/actions/get-deck"),
      ),
    ).toBe(false);

    act(() => {
      orgQueryState.data = { orgId: "first-org" };
      rerender();
    });

    expect(window.location.pathname + window.location.search).toBe(
      "/deck/deep-linked-deck?slide=1",
    );
    await waitFor(() =>
      expect(result.current.getDeck(linkedDeck.id)).toEqual(linkedDeck),
    );
    expect(result.current.loading).toBe(false);
  });

  it.each(["org-a", null])(
    "clears decks from scope %s before loading the next organization",
    async (previousOrgId) => {
      window.history.pushState({}, "", "/");
      orgQueryState.data = { orgId: previousOrgId };
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
    },
  );
});

function openDeck(): Deck {
  return {
    id: "open-deck",
    title: "Open Deck",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    slides: [],
  };
}

function routedWrapper(route: { deckId?: string | null } = {}) {
  return ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(DeckProvider, {
        realtimeEnabled: true,
        openDeckId: route.deckId,
        children,
      }),
    );
}

async function renderOpenDeck(
  options: { decks?: Deck[]; route?: { deckId?: string | null } } = {},
) {
  window.history.pushState({}, "", "/deck/open-deck");
  const api = setupFetch();
  api.setServerDecks(options.decks ?? [openDeck()]);
  const rendered = renderHook(() => useDecks(), {
    wrapper: routedWrapper(options.route),
  });
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return { api, rerender: rendered.rerender, result: rendered.result };
}

describe("fallbackPollIntervalMs", () => {
  const base = {
    liveChannelConnected: false,
    hasOpenDeck: true,
    hidden: false,
    consecutiveFailures: 0,
  };
  it.each([
    ["visible open deck, channel down", {}, 5_000],
    ["visible open deck, channel up", { liveChannelConnected: true }, 60_000],
    ["visible deck list, channel down", { hasOpenDeck: false }, 15_000],
    ["hidden open deck, channel down", { hidden: true }, 30_000],
    [
      "hidden open deck, channel up",
      { hidden: true, liveChannelConnected: true },
      60_000,
    ],
    ["hidden deck list", { hidden: true, hasOpenDeck: false }, null],
    ["visible, 1 failure", { consecutiveFailures: 1 }, 5_000],
    ["visible, 2 failures", { consecutiveFailures: 2 }, 15_000],
    ["visible, 3 failures", { consecutiveFailures: 3 }, 60_000],
    ["visible, 9 failures", { consecutiveFailures: 9 }, 60_000],
    ["hidden, 1 failure", { hidden: true, consecutiveFailures: 1 }, 60_000],
    ["hidden, 2 failures", { hidden: true, consecutiveFailures: 2 }, null],
  ] as const)("%s", (_label, overrides, expected) => {
    expect(fallbackPollIntervalMs({ ...base, ...overrides })).toBe(expected);
  });
});

describe("DeckContext fallback polling", () => {
  beforeEach(() => {
    _resetSyncTransportRegistryForTests();
    orgQueryState.data = { orgId: null };
    orgQueryState.isLoading = false;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("EventSource", MockEventSource);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    orgQueryState.data = { orgId: null };
    orgQueryState.isLoading = false;
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

  it("exposes an in-flight home deck-list refresh", async () => {
    window.history.pushState({}, "", "/");
    const api = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(listCallCount(api.fetchMock)).toBeGreaterThan(1),
    );

    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    api.holdNextList();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
      await Promise.resolve();
    });

    await waitFor(() => expect(api.listRequestPending()).toBe(true));
    expect(result.current.deckListRefreshing).toBe(true);

    await act(async () => {
      api.releaseList([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.deckListRefreshing).toBe(false));
  });

  it("keeps an incomplete deck-list hydration in an error state until it recovers", async () => {
    window.history.pushState({}, "", "/");
    const api = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(listCallCount(api.fetchMock)).toBeGreaterThan(1),
    );

    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const newDeck: Deck = {
      id: "unhydrated-deck",
      title: "Unhydrated Deck",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    api.setServerDecks([newDeck]);
    api.setMissingDeckDetails([newDeck.id]);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loadError).toBe(true));
    await waitFor(() => expect(result.current.deckListRefreshing).toBe(false));

    expect(result.current.decks).toEqual([]);

    api.setMissingDeckDetails([]);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.decks).toEqual([newDeck]));
    expect(result.current.loadError).toBe(false);
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

  it("keeps reconciling the open deck at the hidden cadence while the tab is hidden", async () => {
    const { api } = await renderOpenDeck();

    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const deckBefore = deckCallCount(api.fetchMock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(deckCallCount(api.fetchMock) - deckBefore).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(deckCallCount(api.fetchMock) - deckBefore).toBe(1);
  });

  it("stops polling when the open deck is gone, and reads again on focus", async () => {
    const { api } = await renderOpenDeck();

    api.setServerDecks([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    const deckAfterStop = deckCallCount(api.fetchMock);
    const listAfterStop = listCallCount(api.fetchMock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(deckCallCount(api.fetchMock)).toBe(deckAfterStop);
    expect(listCallCount(api.fetchMock)).toBe(listAfterStop);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(deckCallCount(api.fetchMock)).toBe(deckAfterStop + 1);
  });

  it.each([403, 404])(
    "flags the open deck as access lost on a %i read, keeps the local copy, and recovers on focus",
    async (status) => {
      const { api } = await renderOpenDeck();
      expect(hasFailedDeckSave("open-deck")).toBe(false);

      api.failDeckReads(status);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(getDeckSaveError("open-deck")).toMatchObject({
        status,
        retryable: true,
      });
      const deckAfterLoss = deckCallCount(api.fetchMock);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });
      expect(deckCallCount(api.fetchMock)).toBe(deckAfterLoss);

      api.failDeckReads(null);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(hasFailedDeckSave("open-deck")).toBe(false);
    },
  );

  it("keeps the local copy of the open deck when a list refresh omits it", async () => {
    const { api, result } = await renderOpenDeck();
    // Once this session has created a deck, a list that omits a deck removes it.
    act(() => {
      result.current.createDeck(undefined, { noDefaultSlides: true });
    });
    // The first tick that is due for a list read reads the list before the deck.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    api.setServerDecks([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(result.current.getDeck("open-deck")).toBeDefined();
    expect(getDeckSaveError("open-deck")).toMatchObject({ status: 404 });
  });

  it("drops the access-lost flag with the deck when it is deleted", async () => {
    const { api, result } = await renderOpenDeck();
    api.failDeckReads(403);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(hasFailedDeckSave("open-deck")).toBe(true);

    await act(async () => {
      await result.current.deleteDeck("open-deck");
    });

    expect(hasFailedDeckSave("open-deck")).toBe(false);
  });

  it("clears the flag when a reload finds the deck again", async () => {
    const { api, result } = await renderOpenDeck();
    api.failDeckReads(403);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(hasFailedDeckSave("open-deck")).toBe(true);

    api.failDeckReads(null);
    await act(async () => {
      await result.current.reloadDecks();
    });

    expect(hasFailedDeckSave("open-deck")).toBe(false);
  });

  it("clears access-loss flags when the organization scope changes", async () => {
    orgQueryState.data = { orgId: "org-a" };
    const { api, result, rerender } = await renderOpenDeck();
    api.failDeckReads(403);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(hasFailedDeckSave("open-deck")).toBe(true);

    act(() => {
      orgQueryState.data = { orgId: "org-b" };
      rerender();
    });

    expect(hasFailedDeckSave("open-deck")).toBe(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hasFailedDeckSave("open-deck")).toBe(false);
  });

  it("does not flag a deferred deck create as access lost while it saves", async () => {
    const route = { deckId: "open-deck" as string | null };
    const { api, result, rerender } = await renderOpenDeck({ route });
    const localDeck = result.current.createDeck("Deferred Deck", {
      deferPersistence: true,
    });
    let persistence: Promise<unknown> = Promise.resolve();
    act(() => {
      window.history.pushState({}, "", `/deck/${localDeck.id}`);
      route.deckId = localDeck.id;
      rerender();
      persistence = result.current.ensureDeckPersisted(localDeck.id);
    });

    api.failDeckReads(404);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(deckCallIds(api.fetchMock)).toContain(localDeck.id);
    expect(hasFailedDeckSave(localDeck.id)).toBe(false);

    api.setServerDecks([openDeck(), localDeck]);
    await act(async () => {
      api.resolveCreate(new Response("", { status: 200 }));
      await persistence;
    });
  });

  describe("a deck whose create request failed", () => {
    async function openFailedCreate() {
      const route = { deckId: "open-deck" as string | null };
      const rendered = await renderOpenDeck({ route });
      let created!: Deck;
      act(() => {
        created = rendered.result.current.createDeck("Optimistic Deck");
      });
      act(() => {
        window.history.pushState({}, "", `/deck/${created.id}`);
        route.deckId = created.id;
        rendered.rerender();
      });
      await act(async () => {
        rendered.api.resolveCreate(new Response("", { status: 500 }));
        await vi.advanceTimersByTimeAsync(0);
      });
      return { ...rendered, created, route };
    }

    it("is reported as a failed create when its read then answers 404", async () => {
      const { api, created } = await openFailedCreate();

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(deckCallIds(api.fetchMock)).toContain(created.id);
      expect(hasFailedDeckSave(created.id)).toBe(true);
      expect(getDeckSaveError(created.id)).toMatchObject({
        errorCode: "deck_create_failed",
      });
      expect(getDeckSaveError(created.id)?.status).toBeUndefined();
    });

    it("survives a deck-list reload that does not list it", async () => {
      const { api, result, created, route, rerender } =
        await openFailedCreate();
      act(() => {
        window.history.pushState({}, "", "/deck/open-deck");
        route.deckId = "open-deck";
        rerender();
      });
      // A later create moves the snapshot boundary past the failed one.
      act(() => {
        result.current.createDeck("Later Deck");
      });
      api.setServerDecks([openDeck()]);

      await act(async () => {
        await result.current.reloadDecks();
      });

      expect(result.current.getDeck(created.id)).toBeDefined();
      expect(hasFailedDeckSave(created.id)).toBe(true);
    });

    it("survives a deck-list refresh that does not list it", async () => {
      const { api, result, created, route, rerender } =
        await openFailedCreate();
      // The open deck is never removed by a list refresh; leave it first.
      act(() => {
        window.history.pushState({}, "", "/deck/open-deck");
        route.deckId = "open-deck";
        rerender();
      });
      // A later create moves the snapshot boundary past the failed one.
      act(() => {
        result.current.createDeck("Later Deck");
      });
      api.setServerDecks([openDeck()]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(listCallCount(api.fetchMock)).toBeGreaterThan(1);
      expect(result.current.getDeck(created.id)).toBeDefined();
    });

    it("keeps the deck counted as unsaved so leaving the page cannot discard its only copy", async () => {
      const { created } = await openFailedCreate();

      expect(hasUnsavedDeckChanges(created.id)).toBe(true);
    });

    it("is reported as a failed create when a write answered 404 before the create rejected", async () => {
      const route = { deckId: "open-deck" as string | null };
      const { api, result, rerender } = await renderOpenDeck({ route });
      let created!: Deck;
      act(() => {
        created = result.current.createDeck("Optimistic Deck");
      });
      act(() => {
        window.history.pushState({}, "", `/deck/${created.id}`);
        route.deckId = created.id;
        rerender();
      });
      const real = api.fetchMock.getMockImplementation()!;
      api.fetchMock.mockImplementation((url) =>
        requestString(url).includes("/_agent-native/actions/patch-deck")
          ? Promise.resolve(new Response("", { status: 404 }))
          : real(url),
      );
      await act(async () => {
        result.current.updateDeck(created.id, { title: "Renamed" });
        await vi.advanceTimersByTimeAsync(2_000);
      });

      await act(async () => {
        api.resolveCreate(new Response("", { status: 500 }));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(getDeckSaveError(created.id)).toMatchObject({
        errorCode: "deck_create_failed",
      });
      expect(getDeckSaveError(created.id)?.status).toBeUndefined();
    });

    it("leaves no failure behind when the deck was deleted while its create was pending", async () => {
      const route = { deckId: "open-deck" as string | null };
      const { api, result } = await renderOpenDeck({ route });
      let created!: Deck;
      act(() => {
        created = result.current.createDeck("Doomed Deck");
      });
      act(() => {
        result.current.deleteDeck(created.id);
      });

      await act(async () => {
        api.resolveCreate(new Response("", { status: 500 }));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(hasFailedDeckSave(created.id)).toBe(false);
      expect(hasUnsavedDeckChanges(created.id)).toBe(false);
    });

    it("is not reported as lost access when a later write answers 404", async () => {
      const { api, result, created } = await openFailedCreate();
      const real = api.fetchMock.getMockImplementation()!;
      api.fetchMock.mockImplementation((url) =>
        requestString(url).includes("/_agent-native/actions/patch-deck")
          ? Promise.resolve(new Response("", { status: 404 }))
          : real(url),
      );

      await act(async () => {
        result.current.updateDeck(created.id, { title: "Renamed" });
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(hasFailedDeckSave(created.id)).toBe(true);
      expect(getDeckSaveError(created.id)).toMatchObject({
        errorCode: "deck_create_failed",
      });
      expect(getDeckSaveError(created.id)?.status).toBeUndefined();
    });

    it("clears the failure later writes reported once a read finds the deck", async () => {
      const { api, result, created } = await openFailedCreate();
      const real = api.fetchMock.getMockImplementation()!;
      api.fetchMock.mockImplementation((url) =>
        requestString(url).includes("/_agent-native/actions/patch-deck")
          ? Promise.resolve(new Response("", { status: 404 }))
          : real(url),
      );
      await act(async () => {
        result.current.updateDeck(created.id, { title: "Renamed" });
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(getDeckSaveError(created.id)).toMatchObject({
        errorCode: "deck_create_failed",
      });

      api.setServerDecks([openDeck(), created]);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(hasFailedDeckSave(created.id)).toBe(false);
      expect(getDeckSaveError(created.id)).toBeUndefined();
    });

    it("clears when the deck turns out to exist on the server", async () => {
      const { api, created } = await openFailedCreate();
      expect(hasFailedDeckSave(created.id)).toBe(true);

      api.setServerDecks([openDeck(), created]);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(hasFailedDeckSave(created.id)).toBe(false);
    });
  });

  it("ignores a 404 from a read that began while the create was still pending", async () => {
    const route = { deckId: "open-deck" as string | null };
    const { api, result, rerender } = await renderOpenDeck({ route });
    let created!: Deck;
    act(() => {
      created = result.current.createDeck("Pending Deck");
    });
    act(() => {
      window.history.pushState({}, "", `/deck/${created.id}`);
      route.deckId = created.id;
      rerender();
    });

    const real = api.fetchMock.getMockImplementation()!;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.fetchMock.mockImplementation((url) => {
      const response = real(url);
      return requestString(url).includes(`get-deck?id=${created.id}`)
        ? response.then((r) => gate.then(() => r))
        : response;
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      api.resolveCreate(new Response("", { status: 200 }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hasFailedDeckSave(created.id)).toBe(false);
  });

  it("does not report create failure after a successful read confirms the deck", async () => {
    const { api, result } = await renderOpenDeck();
    let created!: Deck;
    act(() => {
      created = result.current.createDeck("Confirmed Deck");
    });
    api.setServerDecks([openDeck(), created]);

    await act(async () => {
      await result.current.refreshOpenDeck(created.id);
    });
    await act(async () => {
      api.resolveCreate(new Response("", { status: 500 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.getDeck(created.id)).toBeDefined();
    expect(hasFailedDeckSave(created.id)).toBe(false);
    expect(getDeckSaveError(created.id)).toBeUndefined();
  });

  it("retries a remote read when a draft save settles during the read", async () => {
    const initial = {
      ...openDeck(),
      slides: [
        {
          id: "slide-1",
          content: "<div>Original</div>",
          notes: "",
          layout: "content" as const,
        },
      ],
    };
    const { api, result } = await renderOpenDeck({ decks: [initial] });
    const remoteContent = "<div>Agent update</div>";
    const remote = {
      ...initial,
      slides: [{ ...initial.slides[0]!, content: remoteContent }],
    };
    const draft = "<div>Local draft</div>";
    const applier = vi.fn(() => "applied" as const);
    const unregister = registerInlineEditRemoteApplier(
      initial.id,
      "slide-1",
      applier,
    );
    const beforeReads = deckCallIds(api.fetchMock).length;
    const real = api.fetchMock.getMockImplementation()!;
    let releaseRead = () => {};
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
    api.setServerDecks([initial]);
    api.fetchMock.mockImplementationOnce((url) => {
      const response = real(url);
      return requestString(url).includes("get-deck?id=open-deck")
        ? response.then((r) => readGate.then(() => r))
        : response;
    });
    let read: Promise<Deck | null> = Promise.resolve(null);

    try {
      act(() => {
        markSlideEditingActive(initial.id, "slide-1");
        read = result.current.refreshOpenDeck(initial.id);
      });
      await waitFor(() =>
        expect(deckCallIds(api.fetchMock).length).toBe(beforeReads + 1),
      );

      act(() => {
        result.current.updateSlide(
          initial.id,
          "slide-1",
          { content: draft },
          { persistence: "immediate", preserveLocalState: true },
        );
      });
      await act(async () => {
        await result.current.flushDeckSave(initial.id);
      });
      api.setServerDecks([remote]);

      await act(async () => {
        releaseRead();
        await read;
      });

      await waitFor(() =>
        expect(applier).toHaveBeenCalledWith(draft, remoteContent),
      );
      expect(result.current.getDeck(initial.id)?.slides[0]?.content).toBe(
        remoteContent,
      );
    } finally {
      unregister();
      clearSlideEditingActive(initial.id, "slide-1");
    }
  });

  it("clears a read-side access-loss flag after a successful save", async () => {
    const deckId = "save-after-access-loss";
    window.history.pushState({}, "", `/deck/${deckId}`);
    const api = setupFetch();
    api.setServerDecks([{ ...openDeck(), id: deckId }]);
    const { result } = renderHook(() => useDecks(), {
      wrapper: routedWrapper({ deckId }),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    api.failDeckReads(403);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(hasFailedDeckSave(deckId)).toBe(true);

    await act(async () => {
      result.current.updateDeck(deckId, { title: "Restored access" });
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.getDeck(deckId)?.title).toBe("Restored access");
    expect(hasFailedDeckSave(deckId)).toBe(false);
  });

  it("does not let a superseded successful read clear a newer denial", async () => {
    const { api, result } = await renderOpenDeck();
    api.failDeckReads(403);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(hasFailedDeckSave("open-deck")).toBe(true);

    const real = api.fetchMock.getMockImplementation()!;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    api.fetchMock.mockImplementation((url) => {
      const response = real(url);
      if (held || !requestString(url).includes("actions/get-deck")) {
        return response;
      }
      held = true;
      return response.then((r) => gate.then(() => r));
    });

    api.failDeckReads(null);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    api.failDeckReads(403);
    await act(async () => {
      await result.current.retryDeckSave("open-deck");
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hasFailedDeckSave("open-deck")).toBe(true);
  });

  it("re-reads a deck flagged as access lost when the save status retry runs", async () => {
    const { api, result } = await renderOpenDeck();
    api.failDeckReads(403);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(hasFailedDeckSave("open-deck")).toBe(true);
    const deckAfterLoss = deckCallCount(api.fetchMock);

    api.failDeckReads(null);
    await act(async () => {
      await result.current.retryDeckSave("open-deck");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(deckCallCount(api.fetchMock)).toBe(deckAfterLoss + 1);
    expect(hasFailedDeckSave("open-deck")).toBe(false);
  });

  it("resumes a stopped deck poll when the route moves to another deck", async () => {
    const route = { deckId: "open-deck" as string | null };
    const otherDeck = { ...openDeck(), id: "other-deck" };
    const { api, rerender } = await renderOpenDeck({
      decks: [openDeck(), otherDeck],
      route,
    });

    api.setServerDecks([otherDeck]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(66_000);
    });
    const stoppedCallCount = deckCallIds(api.fetchMock).length;

    window.history.pushState({}, "", "/deck/other-deck");
    route.deckId = "other-deck";
    await act(async () => {
      rerender();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(deckCallIds(api.fetchMock).slice(stoppedCallCount)).toContain(
      "other-deck",
    );
  });

  it("stops polling after a 401 and does not resume on a deck switch", async () => {
    const route = { deckId: "open-deck" as string | null };
    const { api, rerender } = await renderOpenDeck({ route });

    api.failDeckReads(401);
    api.failListReads(401);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    const deckAfterStop = deckCallCount(api.fetchMock);
    const listAfterStop = listCallCount(api.fetchMock);

    window.history.pushState({}, "", "/deck/other-deck");
    route.deckId = "other-deck";
    await act(async () => {
      rerender();
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(deckCallCount(api.fetchMock)).toBe(deckAfterStop);
    expect(listCallCount(api.fetchMock)).toBe(listAfterStop);
  });

  it("backs off a visible open-deck poll on repeated server errors and recovers", async () => {
    const { api } = await renderOpenDeck();

    api.failDeckReads(500);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    const afterFirstFailure = deckCallCount(api.fetchMock);

    // Failing reads are spaced 5s, then 15s, then 60s apart.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(deckCallCount(api.fetchMock)).toBe(afterFirstFailure + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(deckCallCount(api.fetchMock)).toBe(afterFirstFailure + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(deckCallCount(api.fetchMock)).toBe(afterFirstFailure + 2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55_000);
    });
    expect(deckCallCount(api.fetchMock)).toBe(afterFirstFailure + 2);

    api.failDeckReads(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    const afterRecovery = deckCallCount(api.fetchMock);
    expect(afterRecovery).toBe(afterFirstFailure + 3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    expect(deckCallCount(api.fetchMock)).toBe(afterRecovery + 1);
  });

  it("joins focus and visibility triggers that land during one poll into a single read", async () => {
    const { api } = await renderOpenDeck();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const deckBefore = deckCallCount(api.fetchMock);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(deckCallCount(api.fetchMock)).toBe(deckBefore + 1);
  });

  it("still reconciles the open deck on a tick where the list read fails", async () => {
    const { api } = await renderOpenDeck();
    api.failListReads(500);
    const callsBefore = api.fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    const actions = api.fetchMock.mock.calls
      .slice(callsBefore)
      .map(([url]) => requestString(url))
      .filter((href) => /actions\/(list-decks|get-deck)\b/.test(href));
    const listIndexes = actions.flatMap((href, i) =>
      href.includes("list-decks") ? [i] : [],
    );
    expect(listIndexes.length).toBeGreaterThan(0);
    for (const i of listIndexes) {
      expect(actions[i + 1]).toContain("get-deck");
    }
  });

  it("keeps polling the new deck when the previous deck's read lands as a 404 after navigation", async () => {
    const otherDeck = { ...openDeck(), id: "other-deck" };
    const { api } = await renderOpenDeck({ decks: [openDeck(), otherDeck] });

    api.failDeckReads(404);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.history.pushState({}, "", "/deck/other-deck");
      api.failDeckReads(null);
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAfterNavigation = deckCallIds(api.fetchMock).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(deckCallIds(api.fetchMock).slice(callsAfterNavigation)).toContain(
      "other-deck",
    );
  });

  it("does not let a terminal read swallow a write announced during it", async () => {
    const { api } = await renderOpenDeck();
    api.failDeckReads(404);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      api.failDeckReads(null);
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
      await vi.advanceTimersByTimeAsync(0);
    });
    const deckAfterAnnouncement = deckCallCount(api.fetchMock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(deckCallCount(api.fetchMock)).toBeGreaterThan(deckAfterAnnouncement);
  });

  it("parks a hidden open-deck poll after repeated server errors until the tab is visible", async () => {
    const { api } = await renderOpenDeck();

    api.failDeckReads(500);
    hideDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const deckBefore = deckCallCount(api.fetchMock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(deckCallCount(api.fetchMock)).toBe(deckBefore + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(deckCallCount(api.fetchMock)).toBe(deckBefore + 2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(deckCallCount(api.fetchMock)).toBe(deckBefore + 2);

    restoreVisibility?.();
    restoreVisibility = null;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(deckCallCount(api.fetchMock)).toBe(deckBefore + 3);
  });

  it("does not hold a failing deck list at the fast interval while the live channel is up", async () => {
    const { api } = await renderOpenDeck();
    const source = await lastEventSource();
    act(() => {
      source.simulateOpen();
    });

    api.failListReads(500);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const listBefore = listCallCount(api.fetchMock);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    // The old load-error branch retried every 5s (60 reads in 5 minutes).
    expect(listCallCount(api.fetchMock) - listBefore).toBeLessThanOrEqual(6);
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

  it("does not poll the deck list when realtime is disabled", async () => {
    window.history.pushState({}, "", "/p/public-deck");
    const api = setupFetch();
    api.setServerDecks([]);
    const { result } = renderHook(() => useDecks(), {
      wrapper: noRealtimeWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const listBefore = listCallCount(api.fetchMock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(listCallCount(api.fetchMock)).toBe(listBefore);
  });

  it("refreshes the home list after a local agent run when realtime is disabled", async () => {
    window.history.pushState({}, "", "/home");
    const api = setupFetch();
    api.setServerDecks([]);
    const { result } = renderHook(() => useDecks(), {
      wrapper: noRealtimeWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const deck: Deck = {
      id: "local-agent-deck",
      title: "Created by the agent",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      slides: [],
    };
    api.setServerDecks([deck]);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: { completedSideEffect: true, tabId: "thread-1" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "thread-1" },
        }),
      );
    });

    await waitFor(() =>
      expect(result.current.decks.map(({ id }) => id)).toEqual([deck.id]),
    );
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
