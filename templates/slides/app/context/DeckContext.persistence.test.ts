import { _resetSyncTransportRegistryForTests } from "@agent-native/core/client/use-db-sync";
import { DEFAULT_DECK_TITLE } from "@shared/deck-title";
import { hashSlideContent } from "@shared/slide-fit";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const testString = (value: unknown) =>
  typeof value === "string"
    ? value
    : value instanceof URLSearchParams
      ? value.toString()
      : (JSON.stringify(value) ?? "");
const requestString = (value: unknown) =>
  typeof value === "string"
    ? value
    : value instanceof URL
      ? value.toString()
      : value instanceof Request
        ? value.url
        : testString(value);

import { normalizeSlidePadding } from "../lib/normalize-slide-padding";

const orgQueryState = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => orgQueryState,
}));

import {
  DeckProvider,
  clearSlideEditingActive,
  flushPendingSaves,
  hasUnsavedDeckChanges,
  hasUncommittedDeckChanges,
  markSlideEditingActive,
  mergeServerAddedSlides,
  mergeServerSlideUpdate,
  pendingWriteSlideIds,
  useDecks,
  type Deck,
  type DeckReloadStatus,
  type Slide,
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

  /** Simulate the browser successfully (re)establishing the connection. */
  simulateOpen() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  /**
   * Simulate a FATAL SSE error: a non-2xx HTTP response (or bad
   * content-type). Per the EventSource spec this closes the connection and
   * the browser does NOT retry on its own — readyState becomes CLOSED.
   */
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

function setupFetch(options?: {
  hangPut?: boolean;
  deferredPut?: boolean;
  deferredPatch?: boolean;
  failDeckList?: boolean;
  deleteDeckNotFound?: boolean;
  patchFailures?: { deckId: string; count: number };
  putFailures?: { deckId: string; count: number };
  patchResponse?: unknown | ((body: Record<string, unknown>) => unknown);
  putResponse?: unknown | ((body: Record<string, unknown>) => unknown);
}) {
  let resolveCreate: (response: Response) => void = () => {};
  let resolveDeferredPut: (() => void) | null = null;
  let rejectDeferredPut: ((error: unknown) => void) | null = null;
  let firstPutSignal: AbortSignal | undefined;
  let resolveDeferredPatch: (() => void) | null = null;
  let firstPatchSignal: AbortSignal | undefined;
  let deferNextGetDeck = false;
  let resolveDeferredGetDeck: (() => void) | null = null;
  let deferNextDeckList = false;
  let resolveDeferredDeckList: (() => void) | null = null;
  let accessibleDeck: Deck | null = null;
  const patchAttempts = new Map<string, number>();
  const putAttempts = new Map<string, number>();
  const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const href =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

    // Legacy full-replace write. When `hangPut` is set, the request never
    // resolves on its own — it only rejects when its AbortSignal fires, which
    // is exactly what `callAction`'s timeout does. This lets a test prove the
    // timeout drains `inFlightSaves` instead of wedging it.
    if (href.includes("/_agent-native/actions/save-deck")) {
      const deckId = testString(actionCallBody(init).deckId ?? "");
      const attempts = (putAttempts.get(deckId) ?? 0) + 1;
      putAttempts.set(deckId, attempts);
      if (
        options?.deferredPut &&
        accessibleDeck?.id === deckId &&
        attempts === 1
      ) {
        firstPutSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve, reject) => {
          resolveDeferredPut = () =>
            resolve(
              new Response(JSON.stringify({ ok: true }), { status: 200 }),
            );
          rejectDeferredPut = reject;
        });
      }
      if (options?.hangPut && accessibleDeck?.id === deckId && attempts === 1) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              reject(
                Object.assign(new Error("Aborted"), { name: "AbortError" }),
              );
            });
          }
        });
      }
      if (
        deckId === options?.putFailures?.deckId &&
        attempts <= options.putFailures.count
      ) {
        return Promise.reject(new Error("save-deck failed"));
      }
      const response =
        typeof options?.putResponse === "function"
          ? options.putResponse(actionCallBody(init))
          : (options?.putResponse ?? { ok: true });
      return Promise.resolve(
        new Response(JSON.stringify(response), { status: 200 }),
      );
    }

    if (href.includes("/_agent-native/actions/add-deck")) {
      return new Promise<Response>((resolve) => {
        resolveCreate = resolve;
      });
    }

    if (href.includes("/_agent-native/actions/delete-deck")) {
      if (options?.deleteDeckNotFound) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Deck not found" }), {
            status: 404,
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
    }

    if (href.includes("/_agent-native/actions/list-decks")) {
      if (options?.failDeckList) {
        return Promise.resolve(
          new Response("Gateway timeout", { status: 504 }),
        );
      }
      const decks = accessibleDeck ? [accessibleDeck] : [];
      const response = new Response(
        JSON.stringify({ count: decks.length, decks }),
        { status: 200 },
      );
      if (deferNextDeckList) {
        deferNextDeckList = false;
        return new Promise<Response>((resolve) => {
          resolveDeferredDeckList = () => resolve(response);
        });
      }
      return Promise.resolve(response);
    }

    if (href.includes("/_agent-native/actions/get-deck")) {
      if (accessibleDeck) {
        if (deferNextGetDeck) {
          deferNextGetDeck = false;
          const deferredDeck = accessibleDeck;
          return new Promise<Response>((resolve) => {
            resolveDeferredGetDeck = () =>
              resolve(
                new Response(JSON.stringify(deferredDeck), { status: 200 }),
              );
          });
        }
        return Promise.resolve(
          new Response(JSON.stringify(accessibleDeck), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }

    if (href.includes("/_agent-native/actions/patch-deck")) {
      const deckId = testString(actionCallBody(init).deckId ?? "");
      const attempts = (patchAttempts.get(deckId) ?? 0) + 1;
      patchAttempts.set(deckId, attempts);
      if (
        options?.deferredPatch &&
        accessibleDeck?.id === deckId &&
        attempts === 1
      ) {
        firstPatchSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveDeferredPatch = () =>
            resolve(
              new Response(JSON.stringify({ ok: true }), { status: 200 }),
            );
        });
      }
      if (
        deckId === options?.patchFailures?.deckId &&
        attempts <= options.patchFailures.count
      ) {
        return Promise.reject(new Error("patch-deck failed"));
      }
      const response =
        typeof options?.patchResponse === "function"
          ? options.patchResponse(actionCallBody(init))
          : (options?.patchResponse ?? { ok: true });
      return Promise.resolve(
        new Response(JSON.stringify(response), { status: 200 }),
      );
    }

    return Promise.resolve(new Response("", { status: 200 }));
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    resolveCreate: (response: Response) => resolveCreate(response),
    resolveDeferredPut: () => resolveDeferredPut?.(),
    rejectDeferredPut: (error: unknown = new Error("late save failure")) =>
      rejectDeferredPut?.(error),
    getFirstPutSignal: () => firstPutSignal,
    getPutAttempts: (deckId: string) => putAttempts.get(deckId) ?? 0,
    resolveDeferredPatch: () => resolveDeferredPatch?.(),
    getFirstPatchSignal: () => firstPatchSignal,
    deferNextGetDeck: () => {
      deferNextGetDeck = true;
    },
    hasDeferredGetDeck: () => resolveDeferredGetDeck !== null,
    resolveDeferredGetDeck: () => {
      resolveDeferredGetDeck?.();
      resolveDeferredGetDeck = null;
    },
    deferNextDeckList: () => {
      deferNextDeckList = true;
    },
    hasDeferredDeckList: () => resolveDeferredDeckList !== null,
    resolveDeferredDeckList: () => {
      resolveDeferredDeckList?.();
      resolveDeferredDeckList = null;
    },
    setAccessibleDeck: (deck: Deck | null) => {
      accessibleDeck = deck;
    },
    getPatchAttempts: (deckId: string) => patchAttempts.get(deckId) ?? 0,
  };
}

function deckFetchCalls(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls.filter(([url]) =>
    requestString(url).includes("/_agent-native/actions/get-deck"),
  );
}

function actionCallBody(
  init: RequestInit | undefined,
): Record<string, unknown> {
  try {
    return JSON.parse(testString(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function deletedDeck(
  fetchMock: ReturnType<typeof setupFetch>["fetchMock"],
  deckId: string,
): boolean {
  return fetchMock.mock.calls.some(
    ([url, init]) =>
      requestString(url).includes("/_agent-native/actions/delete-deck") &&
      init?.method === "DELETE" &&
      actionCallBody(init).id === deckId,
  );
}

describe("DeckContext deck creation persistence", () => {
  beforeEach(() => {
    _resetSyncTransportRegistryForTests();
    orgQueryState.data = undefined;
    orgQueryState.isLoading = false;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/");
    _resetSyncTransportRegistryForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    queryClient.clear();
    MockEventSource.lastInstance = null;
    MockEventSource.instances = [];
  });

  it("exposes an initial deck-list failure instead of an authoritative empty list", async () => {
    setupFetch({ failDeckList: true });
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.decks).toEqual([]);
    expect(result.current.loadError).toBe(true);
  });

  it("waits for the active organization before loading the deck list", async () => {
    orgQueryState.isLoading = true;
    const accessible = {
      id: "scoped-deck",
      title: "Scoped Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    } satisfies Deck;
    const { fetchMock, setAccessibleDeck } = setupFetch();
    setAccessibleDeck(accessible);

    const { result, rerender } = renderHook(() => useDecks(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        requestString(url).includes("/_agent-native/actions/list-decks"),
      ),
    ).toBe(false);

    orgQueryState.data = { orgId: "org-1" };
    orgQueryState.isLoading = false;
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.decks).toEqual([accessible]);
  });

  it("keeps an unload flush behind the active save chain", async () => {
    window.history.pushState({}, "", "/deck/flush-order-deck");
    const { fetchMock, resolveDeferredPatch, setAccessibleDeck } = setupFetch({
      deferredPatch: true,
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "flush-order-deck",
      title: "Flush order deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
          layoutFitRevision: "initial-revision",
        },
      ],
    });
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide(
        "flush-order-deck",
        "slide-1",
        { content: "<h1>First</h1>" },
        { persistence: "immediate" },
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.updateSlide("flush-order-deck", "slide-1", {
        content: "<h1>Latest</h1>",
      });
      flushPendingSaves();
    });

    expect(
      fetchMock.mock.calls.filter(([url]) =>
        requestString(url).includes("/_agent-native/actions/patch-deck"),
      ),
    ).toHaveLength(1);

    resolveDeferredPatch();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const patchCalls = fetchMock.mock.calls.filter(([url]) =>
      requestString(url).includes("/_agent-native/actions/patch-deck"),
    );
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[1]?.[1]?.keepalive).toBe(true);
    expect(actionCallBody(patchCalls[1]?.[1])).toMatchObject({
      deckId: "flush-order-deck",
      operations: [
        {
          op: "patch-slide",
          slideId: "slide-1",
          fields: { content: "<h1>Latest</h1>" },
        },
      ],
    });

    await result.current.flushDeckSave("flush-order-deck");
  });

  it("requeues a failed keepalive flush for a normal retry", async () => {
    window.history.pushState({}, "", "/deck/flush-retry-deck");
    const { fetchMock, setAccessibleDeck, getPatchAttempts } = setupFetch({
      patchFailures: { deckId: "flush-retry-deck", count: 1 },
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "flush-retry-deck",
      title: "Flush retry deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
        },
      ],
    });
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide("flush-retry-deck", "slide-1", {
        content: "<h1>Latest</h1>",
      });
      flushPendingSaves();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getPatchAttempts("flush-retry-deck")).toBe(1);
    expect(hasUnsavedDeckChanges("flush-retry-deck")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getPatchAttempts("flush-retry-deck")).toBe(2);
    expect(hasUnsavedDeckChanges("flush-retry-deck")).toBe(false);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          requestString(url).includes("/_agent-native/actions/patch-deck") &&
          init?.keepalive === true,
      ),
    ).toBe(true);
  });

  it("merges server layout-fit revisions into optimistic slide writes", async () => {
    window.history.pushState({}, "", "/deck/fit-revision-deck");
    const initial: Deck = {
      id: "fit-revision-deck",
      title: "Fit revision deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    const { setAccessibleDeck } = setupFetch({
      patchResponse: (body: Record<string, unknown>) => {
        const operation = (
          body.operations as Array<{
            slideId: string;
            fields?: { content?: string };
          }>
        )[0];
        const content = normalizeSlidePadding(operation.fields?.content ?? "");
        return {
          ok: true,
          layoutFit: {
            status: "pending",
            slides: [
              {
                slideId: operation.slideId,
                contentHash: hashSlideContent(content),
                layoutFitRevision: "server-patch-revision",
              },
            ],
          },
        };
      },
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    act(() => {
      result.current.updateSlide(
        initial.id,
        "slide-1",
        { content: '<div class="fmd-slide"><h1>After</h1></div>' },
        { persistence: "immediate" },
      );
    });
    expect(
      result.current.getDeck(initial.id)?.slides[0]?.layoutFitRevision,
    ).not.toBe("initial-revision");
    await act(async () => {
      await result.current.flushDeckSave(initial.id);
    });

    expect(
      result.current.getDeck(initial.id)?.slides[0]?.layoutFitRevision,
    ).toBe("server-patch-revision");
    expect(result.current.getDeck(initial.id)?.slides[0]?.content).toBe(
      normalizeSlidePadding('<div class="fmd-slide"><h1>After</h1></div>'),
    );
  });

  it("merges revisions returned by add-slide and save-deck", async () => {
    window.history.pushState({}, "", "/deck/fit-revision-add-deck");
    const initial: Deck = {
      id: "fit-revision-add-deck",
      title: "Fit revision add deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    const { setAccessibleDeck } = setupFetch({
      patchResponse: (body: Record<string, unknown>) => {
        const operation = (
          body.operations as Array<{
            slideId: string;
            fields?: { content?: string };
          }>
        )[0];
        return {
          ok: true,
          layoutFit: {
            status: "pending",
            slides: [
              {
                slideId: operation.slideId,
                contentHash: hashSlideContent(operation.fields?.content ?? ""),
                layoutFitRevision: "server-add-revision",
              },
            ],
          },
        };
      },
      putResponse: (body: Record<string, unknown>) => {
        const deck = body.deck as { slides: Array<Record<string, unknown>> };
        return {
          ...deck,
          slides: deck.slides.map((slide) => ({
            ...slide,
            layoutFitRevision: "server-full-revision",
          })),
        };
      },
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    let addedSlideId = "";
    act(() => {
      addedSlideId = result.current.addSlide(initial.id, "content", undefined, {
        persistence: "immediate",
      });
    });
    await act(async () => {
      await result.current.flushDeckSave(initial.id);
    });
    expect(
      result.current
        .getDeck(initial.id)
        ?.slides.find((slide) => slide.id === addedSlideId)?.layoutFitRevision,
    ).toBe("server-add-revision");

    act(() => {
      result.current.setDeckSlides(initial.id, [
        { ...initial.slides[0]!, content: "<h1>Replaced</h1>" },
      ]);
    });
    await act(async () => {
      await result.current.flushDeckSave(initial.id);
    });
    expect(
      result.current.getDeck(initial.id)?.slides[0]?.layoutFitRevision,
    ).toBe("server-full-revision");
  });

  it("merges deck-wide fit revisions for aspect-ratio and design-system writes", async () => {
    window.history.pushState({}, "", "/deck/deck-fit-fields");
    const initial: Deck = {
      id: "deck-fit-fields",
      title: "Deck fit fields",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      designSystemId: "ds-old",
      slides: [
        {
          id: "slide-1",
          content: "<h1>One</h1>",
          notes: "",
          layout: "title",
          layoutFitRevision: "initial-revision-1",
        },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "title",
          layoutFitRevision: "initial-revision-2",
        },
      ],
    };
    const { setAccessibleDeck } = setupFetch({
      patchResponse: () => ({
        ok: true,
        layoutFit: {
          status: "pending",
          slides: initial.slides.map((slide, index) => ({
            slideId: slide.id,
            contentHash: hashSlideContent(slide.content),
            layoutFitRevision: `server-deck-revision-${index}`,
          })),
        },
      }),
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    const beforeAspectRevisions = result.current
      .getDeck(initial.id)
      ?.slides.map((slide) => slide.layoutFitRevision);
    act(() => {
      result.current.updateDeck(initial.id, { aspectRatio: "4:3" });
    });
    expect(
      result.current
        .getDeck(initial.id)
        ?.slides.map((slide) => slide.layoutFitRevision),
    ).not.toEqual(beforeAspectRevisions);
    await act(async () => {
      await result.current.flushDeckSave(initial.id);
    });
    expect(
      result.current
        .getDeck(initial.id)
        ?.slides.map((slide) => slide.layoutFitRevision),
    ).toEqual(["server-deck-revision-0", "server-deck-revision-1"]);

    const beforeDesignSystemRevisions = result.current
      .getDeck(initial.id)
      ?.slides.map((slide) => slide.layoutFitRevision);
    act(() => {
      result.current.updateDeck(initial.id, { designSystemId: "ds-new" });
    });
    expect(
      result.current
        .getDeck(initial.id)
        ?.slides.map((slide) => slide.layoutFitRevision),
    ).not.toEqual(beforeDesignSystemRevisions);
    await act(async () => {
      await result.current.flushDeckSave(initial.id);
    });
    expect(
      result.current
        .getDeck(initial.id)
        ?.slides.map((slide) => slide.layoutFitRevision),
    ).toEqual(["server-deck-revision-0", "server-deck-revision-1"]);
  });

  it("awaits the in-flight create request instead of polling for the new deck", async () => {
    const { fetchMock, resolveCreate } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck(undefined, {
        noDefaultSlides: true,
      }).id;
    });
    expect(result.current.getDeck(deckId)?.title).toBe(DEFAULT_DECK_TITLE);

    let settled = false;
    const persisted = result.current
      .ensureDeckPersisted(deckId)
      .then((value) => {
        settled = true;
        return value;
      });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(deckFetchCalls(fetchMock)).toEqual([]);

    resolveCreate(new Response("", { status: 200 }));

    await expect(persisted).resolves.toEqual({ persisted: true });
    expect(deckFetchCalls(fetchMock)).toEqual([]);
  });

  it("reports a failed create request without polling for the optimistic deck", async () => {
    const { fetchMock, resolveCreate } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck(undefined, {
        noDefaultSlides: true,
      }).id;
    });

    const persisted = result.current.ensureDeckPersisted(deckId);
    resolveCreate(
      new Response(JSON.stringify({ error: "Sign in to create a deck" }), {
        status: 403,
      }),
    );

    await expect(persisted).resolves.toMatchObject({
      persisted: false,
      reason: "request-failed",
    });
    expect(deckFetchCalls(fetchMock)).toEqual([]);
  });

  it("can reload the currently open deck after access changes", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.decks).toEqual([]);

    setAccessibleDeck({
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    });

    await act(async () => {
      await result.current.reloadDecks();
    });

    expect(result.current.getDeck("shared-deck")?.title).toBe("Shared Deck");
  });

  it("resets undo history to the reloaded deck baseline", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    });

    await act(async () => {
      await result.current.reloadDecks();
    });

    act(() => {
      result.current.addSlide("shared-deck");
    });

    await waitFor(() => expect(result.current.canUndo).toBe(true));

    act(() => {
      result.current.undo();
    });

    expect(result.current.getDeck("shared-deck")?.slides).toEqual([]);
  });

  it("keeps undo and redo available through keyboard shortcuts", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    });

    await act(async () => {
      await result.current.reloadDecks();
    });

    act(() => {
      result.current.addSlide("shared-deck");
    });

    await waitFor(() => expect(result.current.canUndo).toBe(true));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true }),
      );
    });

    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides).toEqual([]),
    );

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Z",
          metaKey: true,
          shiftKey: true,
        }),
      );
    });

    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides).toHaveLength(1),
    );
  });

  it("skips unchanged slide commits so one undo reaches the prior state", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>Original</div>",
          notes: "",
          layout: "content",
        },
      ],
    });

    await act(async () => {
      await result.current.reloadDecks();
    });

    act(() => {
      result.current.updateSlide("shared-deck", "slide-1", {
        content: "<div>Edited</div>",
      });
    });
    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides[0]?.content).toBe(
        "<div>Edited</div>",
      ),
    );

    // Editor blur/selection paths can emit the current HTML again. It must not
    // become a second invisible history entry.
    act(() => {
      result.current.updateSlide("shared-deck", "slide-1", {
        content: "<div>Edited</div>",
      });
    });

    act(() => {
      result.current.undo();
    });
    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides[0]?.content).toBe(
        "<div>Original</div>",
      ),
    );

    act(() => {
      result.current.redo();
    });
    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides[0]?.content).toBe(
        "<div>Edited</div>",
      ),
    );
  });

  it("persists inline drafts without replacing the local editor state", async () => {
    window.history.pushState({}, "", "/deck/inline-draft-deck");
    const { fetchMock, setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const initial: Deck = {
      id: "inline-draft-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>Original</div>",
          notes: "",
          layout: "content",
        },
      ],
    };
    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide(
        "inline-draft-deck",
        "slide-1",
        { content: "<div>First draft</div>" },
        { preserveLocalState: true },
      );
      result.current.updateSlide(
        "inline-draft-deck",
        "slide-1",
        { content: "<div>Final draft</div>" },
        { preserveLocalState: true },
      );
    });

    expect(
      result.current.getDeck("inline-draft-deck")?.slides[0]?.content,
    ).toBe("<div>Original</div>");
    expect(hasUncommittedDeckChanges("inline-draft-deck", new Set())).toBe(
      true,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const patchCalls = fetchMock.mock.calls.filter(([url, init]) => {
      if (!requestString(url).includes("/_agent-native/actions/patch-deck")) {
        return false;
      }
      return actionCallBody(init).deckId === "inline-draft-deck";
    });
    expect(patchCalls).toHaveLength(1);
    expect(actionCallBody(patchCalls[0]?.[1])).toMatchObject({
      deckId: "inline-draft-deck",
      operations: [
        {
          op: "patch-slide",
          slideId: "slide-1",
          fields: { content: "<div>Final draft</div>" },
        },
      ],
    });
    expect(hasUncommittedDeckChanges("inline-draft-deck", new Set())).toBe(
      false,
    );
  });

  it("persists the latest inline draft when the user reverts before debounce", async () => {
    window.history.pushState({}, "", "/deck/inline-revert-deck");
    const { fetchMock, setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "inline-revert-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>Original</div>",
          notes: "",
          layout: "content",
        },
      ],
    });
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide(
        "inline-revert-deck",
        "slide-1",
        { content: "<div>Draft</div>" },
        { preserveLocalState: true },
      );
      result.current.updateSlide(
        "inline-revert-deck",
        "slide-1",
        { content: "<div>Original</div>" },
        { preserveLocalState: true },
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const patchCalls = fetchMock.mock.calls.filter(([url, init]) => {
      if (!requestString(url).includes("/_agent-native/actions/patch-deck")) {
        return false;
      }
      return actionCallBody(init).deckId === "inline-revert-deck";
    });
    expect(patchCalls).toHaveLength(1);
    expect(actionCallBody(patchCalls[0]?.[1])).toMatchObject({
      operations: [
        {
          fields: { content: "<div>Original</div>" },
        },
      ],
    });
  });

  it("records one undo entry when an inline draft commits", async () => {
    window.history.pushState({}, "", "/deck/inline-undo-deck");
    const { fetchMock, setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "inline-undo-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>Original</div>",
          notes: "",
          layout: "content",
        },
      ],
    });
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide(
        "inline-undo-deck",
        "slide-1",
        { content: "<div>Draft</div>" },
        { preserveLocalState: true },
      );
      // The editor's exit path updates local state and records the one
      // deck-level undo entry without replaying an already-queued server op.
      result.current.updateSlide(
        "inline-undo-deck",
        "slide-1",
        {
          content: "<div>Draft</div>",
        },
        { recordUndoOnly: true },
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        requestString(url).includes("/_agent-native/actions/patch-deck"),
      ),
    ).toHaveLength(1);

    expect(result.current.getDeck("inline-undo-deck")?.slides[0]?.content).toBe(
      "<div>Draft</div>",
    );
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.getDeck("inline-undo-deck")?.slides[0]?.content).toBe(
      "<div>Original</div>",
    );
  });

  it("does not full-replace after an inline draft save and later deck render", async () => {
    window.history.pushState({}, "", "/deck/inline-render-deck");
    const { fetchMock, setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "inline-render-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>Original</div>",
          notes: "",
          layout: "content",
        },
      ],
    });
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide(
        "inline-render-deck",
        "slide-1",
        { content: "<div>Draft</div>" },
        { preserveLocalState: true },
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    await act(async () => {
      await result.current.reloadDecks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const fullSaveCalls = fetchMock.mock.calls.filter(([url, init]) => {
      return (
        requestString(url).includes("/_agent-native/actions/save-deck") &&
        actionCallBody(init).deckId === "inline-render-deck"
      );
    });
    expect(fullSaveCalls).toHaveLength(0);
  });

  it("protects an active inline draft after its autosave drains", async () => {
    window.history.pushState({}, "", "/deck/inline-active-deck");
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const original = {
      id: "inline-active-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>Original</div>",
          notes: "",
          layout: "content",
        },
      ],
    } satisfies Deck;
    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });

    markSlideEditingActive("inline-active-deck", "slide-1");
    try {
      vi.useFakeTimers();
      act(() => {
        result.current.updateSlide(
          "inline-active-deck",
          "slide-1",
          { content: "<div>Draft</div>" },
          { preserveLocalState: true },
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      setAccessibleDeck({
        ...original,
        slides: [{ ...original.slides[0], content: "<div>Agent</div>" }],
      });
      await act(async () => {
        await result.current.refreshOpenDeck("inline-active-deck");
      });

      expect(
        result.current.getDeck("inline-active-deck")?.slides[0]?.content,
      ).toBe("<div>Original</div>");
    } finally {
      clearSlideEditingActive("inline-active-deck", "slide-1");
    }
  });

  it("persists a duplicated slide after the optimistic insert", async () => {
    window.history.pushState({}, "", "/");
    const { fetchMock, resolveCreate } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Deck").id;
    });
    resolveCreate(new Response("", { status: 200 }));

    const originalSlide = result.current.getDeck(deckId)!.slides[0];
    vi.useFakeTimers();
    act(() => {
      result.current.duplicateSlide(deckId, originalSlide.id);
    });

    expect(result.current.getDeck(deckId)?.slides).toHaveLength(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const patchCall = fetchMock.mock.calls.find(([url, init]) => {
      if (!requestString(url).includes("/_agent-native/actions/patch-deck")) {
        return false;
      }
      const body = JSON.parse(testString(init?.body ?? "{}")) as {
        deckId?: string;
      };
      return body.deckId === deckId;
    });
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(testString(patchCall?.[1]?.body))).toMatchObject({
      deckId,
      operations: [
        {
          op: "add-slide",
          afterSlideId: originalSlide.id,
          fields: {
            content: originalSlide.content,
            notes: originalSlide.notes,
            layout: originalSlide.layout,
            background: originalSlide.background,
          },
        },
      ],
    });
  });

  it("records the first edit after reloading over a pending undo skip", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck({
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    });

    await act(async () => {
      await result.current.reloadDecks();
    });

    act(() => {
      result.current.addSlide("shared-deck");
    });
    await waitFor(() => expect(result.current.canUndo).toBe(true));

    act(() => {
      result.current.undo();
    });

    await act(async () => {
      await result.current.reloadDecks();
    });

    act(() => {
      result.current.addSlide("shared-deck");
    });

    await waitFor(() => expect(result.current.canUndo).toBe(true));
  });

  it("undoes a wholesale slide replacement that removed an edited slide", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Seed a deck with two slides directly via addSlide from empty.
    act(() => {
      result.current.createDeck("Deck", { noDefaultSlides: true });
    });
    // The freshly created deck isn't the open route; edit it by id anyway.
    const deckId = result.current.decks[0].id;
    let slideId = "";
    act(() => {
      slideId = result.current.addSlide(deckId);
    });
    act(() => {
      result.current.addSlide(deckId);
    });

    // Edit the first slide (records an undo entry with the prior content).
    act(() => {
      result.current.updateSlide(deckId, slideId, {
        content: "<div>edited</div>",
      });
    });
    await waitFor(() => expect(result.current.canUndo).toBe(true));

    // setDeckSlides is the generated/import replacement path. It replaces the
    // whole slide list and should now be undoable back to the prior deck.
    act(() => {
      result.current.setDeckSlides(
        deckId,
        result.current.getDeck(deckId)!.slides.filter((s) => s.id !== slideId),
      );
    });

    act(() => {
      result.current.undo();
    });
    expect(
      result.current.getDeck(deckId)?.slides.some((s) => s.id === slideId),
    ).toBe(true);
  });

  it("scopes undo per deck — undoing does not mutate a different deck", async () => {
    window.history.pushState({}, "", "/");
    setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.createDeck("Deck A", { noDefaultSlides: true });
    });
    act(() => {
      result.current.createDeck("Deck B", { noDefaultSlides: true });
    });
    const deckA = result.current.decks[0].id;
    const deckB = result.current.decks[1].id;

    // Edit deck A (records undo), then edit deck B.
    act(() => {
      result.current.addSlide(deckA);
    });
    act(() => {
      result.current.updateDeck(deckB, { title: "Deck B renamed" });
    });
    const deckASlidesBefore = result.current.getDeck(deckA)!.slides.length;

    // Undo the most recent entry (deck B's rename). Deck A is untouched.
    act(() => {
      result.current.undo();
    });
    expect(result.current.getDeck(deckB)?.title).toBe("Deck B");
    expect(result.current.getDeck(deckA)?.slides.length).toBe(
      deckASlidesBefore,
    );

    // Undo again (deck A's add-slide). Deck B stays at its (undone) title.
    act(() => {
      result.current.undo();
    });
    expect(result.current.getDeck(deckA)?.slides.length).toBe(
      deckASlidesBefore - 1,
    );
    expect(result.current.getDeck(deckB)?.title).toBe("Deck B");
  });

  it("records create deck on the undo stack", async () => {
    window.history.pushState({}, "", "/");
    setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Draft", { noDefaultSlides: true }).id;
    });
    await waitFor(() => expect(result.current.canUndo).toBe(true));

    act(() => {
      result.current.undo();
    });
    expect(result.current.getDeck(deckId)).toBeUndefined();

    act(() => {
      result.current.redo();
    });
    expect(result.current.getDeck(deckId)?.title).toBe("Draft");
  });

  it("waits for an in-flight create before deleting an undone optimistic deck", async () => {
    window.history.pushState({}, "", "/");
    const { fetchMock, resolveCreate } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Draft", { noDefaultSlides: true }).id;
    });
    await waitFor(() => expect(result.current.canUndo).toBe(true));

    act(() => {
      result.current.undo();
    });
    expect(result.current.getDeck(deckId)).toBeUndefined();
    expect(deletedDeck(fetchMock, deckId)).toBe(false);

    resolveCreate(new Response("", { status: 200 }));

    await waitFor(() => expect(deletedDeck(fetchMock, deckId)).toBe(true));
  });

  it("cleans up after a failed optimistic create without restoring the deck", async () => {
    const { fetchMock, resolveCreate } = setupFetch({
      deleteDeckNotFound: true,
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Failed draft", {
        noDefaultSlides: true,
      }).id;
      result.current.deleteDeck(deckId);
    });

    resolveCreate(
      new Response(JSON.stringify({ error: "Sign in to create a deck" }), {
        status: 403,
      }),
    );

    await waitFor(() => expect(deletedDeck(fetchMock, deckId)).toBe(true));
    expect(result.current.getDeck(deckId)).toBeUndefined();
  });

  it("records delete deck on the undo stack", async () => {
    window.history.pushState({}, "", "/");
    setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Disposable", {
        noDefaultSlides: true,
      }).id;
    });
    act(() => {
      result.current.deleteDeck(deckId);
    });
    expect(result.current.getDeck(deckId)).toBeUndefined();

    act(() => {
      result.current.undo();
    });
    expect(result.current.getDeck(deckId)?.title).toBe("Disposable");
  });

  it("records generated slide replacement on the undo stack", async () => {
    window.history.pushState({}, "", "/");
    setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Generated", {
        noDefaultSlides: true,
      }).id;
    });
    const generated: Slide[] = [
      {
        id: "generated-slide",
        content: "<div>Generated</div>",
        notes: "",
        layout: "content",
      },
    ];

    act(() => {
      result.current.setDeckSlides(deckId, generated);
    });
    expect(result.current.getDeck(deckId)?.slides.map((s) => s.id)).toEqual([
      "generated-slide",
    ]);

    act(() => {
      result.current.undo();
    });
    expect(result.current.getDeck(deckId)?.slides).toEqual([]);
  });

  it("clears omitted deck metadata before an immediate replacement flush and reload", async () => {
    window.history.pushState({}, "", "/deck/restore-deck");
    const initial = {
      id: "restore-deck",
      title: "Imported",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      aspectRatio: "4:3",
      designSystemId: "brand-1",
      tweaks: { titleCase: true },
      starred: true,
      sourceImport: { mode: "source-preserving", format: "pptx" },
      slides: [
        { id: "slide-1", content: "<h1>Old</h1>", notes: "", layout: "title" },
      ],
    } as Deck;
    const { fetchMock, resolveDeferredPut, setAccessibleDeck } = setupFetch({
      deferredPut: true,
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    let flushPromise: Promise<void> | undefined;
    act(() => {
      result.current.setDeckSlides(
        initial.id,
        [
          {
            id: "slide-2",
            content: "<h1>Restored</h1>",
            notes: "",
            layout: "content",
          },
        ],
        {
          deckFields: {
            title: "Restored",
            aspectRatio: "16:9",
            designSystemId: null,
          },
          clearDeckFields: [
            "aspectRatio",
            "designSystemId",
            "tweaks",
            "starred",
            "sourceImport",
          ],
          persistence: "immediate",
          forcePersistence: true,
        },
      );
      flushPromise = result.current.flushDeckSave(initial.id);
    });

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          requestString(url).includes("/_agent-native/actions/save-deck") &&
          actionCallBody(init).deckId === initial.id,
      );
      expect(putCall).toBeTruthy();
    });
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestString(url).includes("/_agent-native/actions/save-deck") &&
        actionCallBody(init).deckId === initial.id,
    );
    const savedDeck = actionCallBody(putCall?.[1]).deck as Record<
      string,
      unknown
    >;
    expect(savedDeck.aspectRatio).toBe("16:9");
    expect(savedDeck.designSystemId).toBeNull();
    expect(savedDeck).not.toHaveProperty("tweaks");
    expect(savedDeck).not.toHaveProperty("starred");
    expect(savedDeck).not.toHaveProperty("sourceImport");
    expect(result.current.getDeck(initial.id)).not.toHaveProperty(
      "sourceImport",
    );

    resolveDeferredPut();
    await act(async () => {
      await flushPromise;
    });

    setAccessibleDeck({
      ...initial,
      ...savedDeck,
      designSystemId: null,
    } as unknown as Deck);
    await act(async () => {
      await result.current.reloadDecks();
    });
    expect(result.current.getDeck(initial.id)?.designSystemId).toBeNull();
  });

  it("persists immediate edits queued after a generated slide replacement", async () => {
    window.history.pushState({}, "", "/");
    const { fetchMock, resolveCreate } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deckId = "";
    act(() => {
      deckId = result.current.createDeck("Generated", {
        noDefaultSlides: true,
      }).id;
    });
    resolveCreate(new Response("", { status: 200 }));

    vi.useFakeTimers();
    act(() => {
      result.current.setDeckSlides(deckId, [
        {
          id: "generated-slide",
          content: "<div>Generated</div>",
          notes: "",
          layout: "content",
        },
      ]);
    });
    act(() => {
      result.current.updateSlide(deckId, "generated-slide", {
        content: "<div>Edited immediately</div>",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestString(url).includes("/_agent-native/actions/save-deck") &&
        init?.method === "PUT" &&
        actionCallBody(init).deckId === deckId,
    );
    expect(putCall).toBeTruthy();
    expect(
      (actionCallBody(putCall?.[1]).deck as { slides: { content: string }[] })
        .slides[0].content,
    ).toBe("<div>Generated</div>");

    const patchCall = fetchMock.mock.calls.find(([url, init]) => {
      if (!requestString(url).includes("/_agent-native/actions/patch-deck")) {
        return false;
      }
      const body = JSON.parse(testString(init?.body ?? "{}")) as {
        deckId?: string;
      };
      return body.deckId === deckId;
    });
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(testString(patchCall?.[1]?.body))).toMatchObject({
      deckId,
      operations: [
        {
          op: "patch-slide",
          slideId: "generated-slide",
          fields: { content: "<div>Edited immediately</div>" },
        },
      ],
    });
  });

  it("retries failed immediate slide HTML ahead of a newer gesture commit", async () => {
    window.history.pushState({}, "", "/deck/gesture-deck");
    const { fetchMock, getPatchAttempts, setAccessibleDeck } = setupFetch({
      patchFailures: { deckId: "gesture-deck", count: 1 },
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const objectId = "durable-title";
    const initialContent = `<div class="fmd-slide"><div data-slide-object-id="${objectId}" style="position:absolute;left:25px;top:85px;width:740px;height:218px">Title</div></div>`;
    const movedContent = `<div class="fmd-slide"><div data-slide-object-id="${objectId}" style="position:absolute;left:65px;top:105px;width:740px;height:218px">Title</div></div>`;
    const resizedContent = `<div class="fmd-slide"><div data-slide-object-id="${objectId}" style="position:absolute;left:65px;top:95.4px;width:740px;height:227.6px">Title</div></div>`;
    const normalizedMovedContent = normalizeSlidePadding(movedContent);
    const normalizedResizedContent = normalizeSlidePadding(resizedContent);
    setAccessibleDeck({
      id: "gesture-deck",
      title: "Gesture deck",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
      slides: [
        {
          id: "gesture-slide",
          content: initialContent,
          notes: "",
          layout: "blank",
        },
      ],
    });
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide(
        "gesture-deck",
        "gesture-slide",
        { content: movedContent },
        { persistence: "immediate" },
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getPatchAttempts("gesture-deck")).toBe(1);

    act(() => {
      result.current.updateSlide(
        "gesture-deck",
        "gesture-slide",
        { content: resizedContent },
        { persistence: "immediate" },
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(getPatchAttempts("gesture-deck")).toBeGreaterThanOrEqual(2);

    const patchCalls = fetchMock.mock.calls.filter(([url]) =>
      requestString(url).includes("/_agent-native/actions/patch-deck"),
    );
    const orderedRetry = patchCalls.find(([, init]) => {
      const operations = actionCallBody(init).operations;
      return (
        Array.isArray(operations) &&
        operations.some(
          (operation) =>
            (operation as { fields?: { content?: string } }).fields?.content ===
            normalizedMovedContent,
        ) &&
        operations.some(
          (operation) =>
            (operation as { fields?: { content?: string } }).fields?.content ===
            normalizedResizedContent,
        )
      );
    });
    expect(actionCallBody(orderedRetry?.[1])).toMatchObject({
      deckId: "gesture-deck",
      operations: [
        {
          op: "patch-slide",
          slideId: "gesture-slide",
          fields: { content: normalizedMovedContent },
        },
        {
          op: "patch-slide",
          slideId: "gesture-slide",
          fields: { content: normalizedResizedContent },
        },
      ],
    });
    expect(result.current.getDeck("gesture-deck")?.slides[0].content).toBe(
      normalizeSlidePadding(resizedContent),
    );

    act(() => result.current.undo());
    expect(result.current.getDeck("gesture-deck")?.slides[0].content).toBe(
      initialContent,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hasUncommittedDeckChanges("gesture-deck", new Set())).toBe(false);
  });

  it("ignores stale reload responses after the route changes", async () => {
    window.history.pushState({}, "", "/");
    const firstDeck: Deck = {
      id: "first-deck",
      title: "First Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    };
    const secondDeck: Deck = {
      id: "second-deck",
      title: "Second Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    };
    let firstDeckRequestStarted = false;
    let resolveFirstDeck: (response: Response) => void = () => {};
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const href =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;

      if (href.includes("/_agent-native/actions/list-decks")) {
        return Promise.resolve(
          new Response(JSON.stringify({ count: 0, decks: [] }), {
            status: 200,
          }),
        );
      }

      if (
        href.includes("/_agent-native/actions/get-deck") &&
        href.includes("id=first-deck")
      ) {
        firstDeckRequestStarted = true;
        return new Promise<Response>((resolve) => {
          resolveFirstDeck = resolve;
        });
      }

      if (
        href.includes("/_agent-native/actions/get-deck") &&
        href.includes("id=second-deck")
      ) {
        return Promise.resolve(
          new Response(JSON.stringify(secondDeck), { status: 200 }),
        );
      }

      return Promise.resolve(new Response("", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDecks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    window.history.pushState({}, "", "/deck/first-deck");
    let firstReload: Promise<DeckReloadStatus> = Promise.resolve("stale");
    act(() => {
      firstReload = result.current.reloadDecksWithStatus();
    });
    await waitFor(() => expect(firstDeckRequestStarted).toBe(true));

    window.history.pushState({}, "", "/deck/second-deck");
    let secondStatus: DeckReloadStatus | undefined;
    await act(async () => {
      secondStatus = await result.current.reloadDecksWithStatus();
    });
    expect(secondStatus).toBe("loaded");
    expect(result.current.getDeck("second-deck")?.title).toBe("Second Deck");

    let firstStatus: DeckReloadStatus | undefined;
    await act(async () => {
      resolveFirstDeck(
        new Response(JSON.stringify(firstDeck), { status: 200 }),
      );
      firstStatus = await firstReload;
    });

    expect(firstStatus).toBe("stale");
    expect(result.current.getDeck("second-deck")?.title).toBe("Second Deck");
    expect(result.current.getDeck("first-deck")).toBeUndefined();
  });

  it("clears loading when the initial response becomes stale after navigation", async () => {
    window.history.pushState({}, "", "/deck/first-deck");
    const firstDeck: Deck = {
      id: "first-deck",
      title: "First Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    };
    let resolveDecks: (response: Response) => void = () => {};
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const href =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;

      if (href.includes("/_agent-native/actions/list-decks")) {
        return new Promise<Response>((resolve) => {
          resolveDecks = resolve;
        });
      }

      return Promise.resolve(new Response("", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    window.history.pushState({}, "", "/deck/second-deck");
    await act(async () => {
      resolveDecks(
        new Response(JSON.stringify({ count: 1, decks: [firstDeck] }), {
          status: 200,
        }),
      );
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getDeck("first-deck")).toBeUndefined();
  });

  it("records undo for agent/SSE deck updates so Undo is available after chat edits", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const initial: Deck = {
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides[0]?.content).toBe(
        "<h1>Before</h1>",
      ),
    );

    const agentUpdated: Deck = {
      ...initial,
      updatedAt: "2026-05-12T00:01:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>After agent edit</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    setAccessibleDeck(agentUpdated);

    const source = MockEventSource.lastInstance;
    expect(source?.onmessage).toBeTruthy();
    await waitFor(() =>
      expect(hasUncommittedDeckChanges("shared-deck", new Set())).toBe(false),
    );

    await act(async () => {
      source!.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "deck-changed",
            deckId: "shared-deck",
          }),
        }),
      );
    });

    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides[0]?.content).toBe(
        "<h1>After agent edit</h1>",
      ),
    );
    await waitFor(() => expect(result.current.canUndo).toBe(true));

    act(() => {
      result.current.undo();
    });

    expect(result.current.getDeck("shared-deck")?.slides[0]?.content).toBe(
      "<h1>Before</h1>",
    );
  });

  it("drops stale pending writes when restoring an open deck so later deletes stay granular", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const original: Deck = {
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>One</h1>",
          notes: "",
          layout: "title",
        },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { fetchMock, setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides).toHaveLength(2),
    );

    vi.useFakeTimers();
    act(() => {
      result.current.setDeckSlides("shared-deck", [
        {
          ...original.slides[0]!,
          content: "<h1>Edited one</h1>",
        },
        original.slides[1]!,
      ]);
    });
    expect(hasUncommittedDeckChanges("shared-deck", new Set())).toBe(true);

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.refreshOpenDeck("shared-deck", {
        clearPendingWrites: true,
      });
    });
    expect(hasUncommittedDeckChanges("shared-deck", new Set())).toBe(false);
    expect(result.current.getDeck("shared-deck")?.slides[0]?.content).toBe(
      "<h1>One</h1>",
    );

    const slideId = result.current.getDeck("shared-deck")!.slides[0]!.id;
    let duplicateId = "";
    act(() => {
      duplicateId = result.current.duplicateSlide("shared-deck", slideId)!;
      result.current.deleteSlide("shared-deck", duplicateId);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const saveCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        requestString(url).includes("/_agent-native/actions/save-deck") &&
        init?.method === "PUT" &&
        actionCallBody(init).deckId === "shared-deck"
      );
    });
    expect(saveCall).toBeUndefined();

    const patchCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        requestString(url).includes("/_agent-native/actions/patch-deck") &&
        actionCallBody(init).deckId === "shared-deck"
      );
    });
    expect(patchCall).toBeTruthy();
    expect(actionCallBody(patchCall?.[1])).toMatchObject({
      deckId: "shared-deck",
      operations: expect.arrayContaining([
        expect.objectContaining({
          op: "delete-slide",
          slideId: duplicateId,
        }),
      ]),
    });

    vi.useRealTimers();
  });

  it("reorders by slide id after a thumbnail delete and keeps the granular op and undo", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const original: Deck = {
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
        {
          id: "slide-3",
          content: "<h1>Three</h1>",
          notes: "",
          layout: "content",
        },
        {
          id: "slide-4",
          content: "<h1>Four</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { fetchMock, setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides).toHaveLength(4),
    );

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide("shared-deck", "slide-2");
      result.current.reorderSlides("shared-deck", "slide-4", "slide-1");
      result.current.reorderSlides("shared-deck", "slide-1", "slide-3");
    });

    expect(
      result.current.getDeck("shared-deck")?.slides.map((slide) => slide.id),
    ).toEqual(["slide-4", "slide-3", "slide-1"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const patchCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        requestString(url).includes("/_agent-native/actions/patch-deck") &&
        actionCallBody(init).deckId === "shared-deck"
      );
    });
    expect(patchCall).toBeTruthy();
    expect(actionCallBody(patchCall?.[1])).toMatchObject({
      deckId: "shared-deck",
      operations: [
        {
          op: "delete-slide",
          slideId: "slide-2",
        },
        {
          op: "reorder-slides",
          orderedIds: ["slide-4", "slide-1", "slide-3"],
        },
        {
          op: "reorder-slides",
          orderedIds: ["slide-4", "slide-3", "slide-1"],
        },
      ],
    });

    expect(result.current.canUndo).toBe(true);
    act(() => {
      result.current.undo();
    });
    expect(
      result.current.getDeck("shared-deck")?.slides.map((slide) => slide.id),
    ).toEqual(["slide-4", "slide-1", "slide-3"]);

    vi.useRealTimers();
  });

  it("does not resurrect a locally deleted slide from a stale open-deck refetch", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const original: Deck = {
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
        {
          id: "slide-3",
          content: "<h1>Three</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { setAccessibleDeck, getFirstPatchSignal, resolveDeferredPatch } =
      setupFetch({ deferredPatch: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides).toHaveLength(3),
    );

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide("shared-deck", "slide-2");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getFirstPatchSignal()).toBeDefined();
    expect(
      result.current.getDeck("shared-deck")?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1", "slide-3"]);
    expect(hasUncommittedDeckChanges("shared-deck", new Set())).toBe(true);

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.refreshOpenDeck("shared-deck");
    });

    expect(
      result.current.getDeck("shared-deck")?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1", "slide-3"]);

    resolveDeferredPatch();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      result.current.getDeck("shared-deck")?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1", "slide-3"]);
    vi.useRealTimers();
  });

  it("keeps a stale refetch from resurrecting a delete after the save settles", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const original: Deck = {
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const {
      setAccessibleDeck,
      deferNextGetDeck,
      hasDeferredGetDeck,
      resolveDeferredGetDeck,
      getFirstPatchSignal,
      resolveDeferredPatch,
    } = setupFetch({ deferredPatch: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck("shared-deck")?.slides).toHaveLength(2),
    );

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide("shared-deck", "slide-2");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getFirstPatchSignal()).toBeDefined();

    deferNextGetDeck();
    const staleRefresh = result.current.refreshOpenDeck("shared-deck");
    expect(hasDeferredGetDeck()).toBe(true);

    resolveDeferredPatch();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hasUncommittedDeckChanges("shared-deck", new Set())).toBe(false);

    resolveDeferredGetDeck();
    await act(async () => {
      await staleRefresh;
    });
    expect(
      result.current.getDeck("shared-deck")?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1"]);
    vi.useRealTimers();
  });

  it("does not let a read that spans a local save revert the saved slide", async () => {
    // The write starts AFTER the read is issued, so nothing is pending at
    // either endpoint to reveal that the response predates it. Only the local
    // write counter can see this; without it the clean-deck branch adopts the
    // stale snapshot wholesale and the user's edit visibly reverts.
    window.history.pushState({}, "", "/deck/race-deck");
    const original: Deck = {
      id: "race-deck",
      title: "Race Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Server before save</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    const { setAccessibleDeck, deferNextGetDeck, resolveDeferredGetDeck } =
      setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck("race-deck")?.slides).toHaveLength(1),
    );

    // Read starts while the deck is clean — the server still holds the old body.
    deferNextGetDeck();
    const staleRefresh = result.current.refreshOpenDeck("race-deck");

    // ...then the user edits and the save completes, entirely inside the read.
    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide("race-deck", "slide-1", {
        content: "<h1>Just typed</h1>",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.useRealTimers();
    await waitFor(() =>
      expect(hasUncommittedDeckChanges("race-deck", new Set())).toBe(false),
    );

    resolveDeferredGetDeck();
    await act(async () => {
      await staleRefresh;
    });

    expect(result.current.getDeck("race-deck")?.slides[0]?.content).toBe(
      "<h1>Just typed</h1>",
    );
  });

  it("does not let a stale baseline reload resurrect a deleted slide", async () => {
    window.history.pushState({}, "", "/deck/shared-deck");
    const original: Deck = {
      id: "shared-deck",
      title: "Shared Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const {
      setAccessibleDeck,
      deferNextGetDeck,
      hasDeferredGetDeck,
      resolveDeferredGetDeck,
      getFirstPatchSignal,
      resolveDeferredPatch,
    } = setupFetch({ deferredPatch: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide("shared-deck", "slide-2");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getFirstPatchSignal()).toBeDefined();

    deferNextGetDeck();
    const staleReload = result.current.reloadDecks();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hasDeferredGetDeck()).toBe(true);

    resolveDeferredPatch();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hasUncommittedDeckChanges("shared-deck", new Set())).toBe(false);

    setAccessibleDeck({ ...original, slides: [original.slides[0]!] });
    resolveDeferredGetDeck();
    await act(async () => {
      await staleReload;
    });

    expect(
      result.current.getDeck("shared-deck")?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1"]);
    vi.useRealTimers();
  });

  it("ignores an in-flight deck-list diff after a baseline reload", async () => {
    window.history.pushState({}, "", "/");
    const deck: Deck = {
      id: "baseline-list-deck",
      title: "Baseline list deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [],
    };
    const {
      setAccessibleDeck,
      deferNextDeckList,
      hasDeferredDeckList,
      resolveDeferredDeckList,
    } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(deck);
    await act(async () => {
      await result.current.reloadDecks();
    });
    expect(result.current.getDeck(deck.id)?.title).toBe(deck.title);

    setAccessibleDeck(null);
    deferNextDeckList();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(hasDeferredDeckList()).toBe(true));

    setAccessibleDeck(deck);
    await act(async () => {
      await result.current.reloadDecks();
    });
    resolveDeferredDeckList();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.getDeck(deck.id)?.title).toBe(deck.title);
  });

  it("shows a deleted slide again after its save permanently fails", async () => {
    window.history.pushState({}, "", "/deck/failed-delete-deck");
    const original: Deck = {
      id: "failed-delete-deck",
      title: "Failed delete deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { setAccessibleDeck, getPatchAttempts } = setupFetch({
      patchFailures: { deckId: "failed-delete-deck", count: 3 },
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide("failed-delete-deck", "slide-2");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_250);
    });
    expect(getPatchAttempts("failed-delete-deck")).toBe(3);
    expect(hasUncommittedDeckChanges("failed-delete-deck", new Set())).toBe(
      true,
    );

    await act(async () => {
      await result.current.reloadDecks();
    });

    expect(
      result.current
        .getDeck("failed-delete-deck")
        ?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1", "slide-2"]);
    vi.useRealTimers();
  });

  it("re-establishes delete protection when a later edit retries a failed delete", async () => {
    window.history.pushState({}, "", "/deck/retry-delete-deck");
    const original: Deck = {
      id: "retry-delete-deck",
      title: "Retry delete deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const {
      setAccessibleDeck,
      getPatchAttempts,
      deferNextGetDeck,
      hasDeferredGetDeck,
      resolveDeferredGetDeck,
    } = setupFetch({
      patchFailures: { deckId: "retry-delete-deck", count: 3 },
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(original);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide("retry-delete-deck", "slide-2");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_250);
    });
    expect(getPatchAttempts("retry-delete-deck")).toBe(3);

    await act(async () => {
      await result.current.reloadDecks();
    });
    expect(
      result.current
        .getDeck("retry-delete-deck")
        ?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1", "slide-2"]);

    act(() => {
      result.current.updateSlide("retry-delete-deck", "slide-1", {
        content: "<h1>Edited after retry</h1>",
      });
    });

    deferNextGetDeck();
    const delayedRefresh = result.current.refreshOpenDeck("retry-delete-deck");
    await act(async () => {
      await Promise.resolve();
    });
    expect(hasDeferredGetDeck()).toBe(true);

    resolveDeferredGetDeck();
    await act(async () => {
      await delayedRefresh;
    });
    expect(
      result.current
        .getDeck("retry-delete-deck")
        ?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1", "slide-2"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getPatchAttempts("retry-delete-deck")).toBe(4);
    vi.useRealTimers();
  });

  it("preserves newer delete tombstones after a replacement save", async () => {
    window.history.pushState({}, "", "/deck/replacement-delete-race-deck");
    const initial: Deck = {
      id: "replacement-delete-race-deck",
      title: "Replacement delete race deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
        {
          id: "slide-3",
          content: "<h1>Three</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const {
      setAccessibleDeck,
      resolveDeferredPut,
      deferNextGetDeck,
      hasDeferredGetDeck,
      resolveDeferredGetDeck,
      resolveDeferredPatch,
      getPatchAttempts,
      getFirstPutSignal,
    } = setupFetch({ deferredPut: true, deferredPatch: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    const replacementSlides = [
      initial.slides[1]!,
      { ...initial.slides[2]!, content: "<h1>Replaced three</h1>" },
    ];
    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide(initial.id, "slide-1");
      result.current.setDeckSlides(initial.id, replacementSlides);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getFirstPutSignal()).toBeDefined();

    act(() => {
      result.current.deleteSlide(initial.id, "slide-2");
    });
    setAccessibleDeck({
      ...initial,
      updatedAt: "2026-05-12T00:02:00.000Z",
    });
    deferNextGetDeck();
    const staleRefresh = result.current.refreshOpenDeck(initial.id);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hasDeferredGetDeck()).toBe(true);

    resolveDeferredPut();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getPatchAttempts(initial.id)).toBe(1);

    resolveDeferredPatch();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    resolveDeferredGetDeck();
    await act(async () => {
      await staleRefresh;
    });

    expect(
      result.current.getDeck(initial.id)?.slides.map((slide) => slide.id),
    ).toEqual(["slide-3"]);
    vi.useRealTimers();
  });

  it("does not clear a newer delete when a replacement save succeeds", async () => {
    window.history.pushState({}, "", "/deck/replacement-same-slide-deck");
    const initial: Deck = {
      id: "replacement-same-slide-deck",
      title: "Replacement same slide deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { setAccessibleDeck, resolveDeferredPut, getFirstPutSignal } =
      setupFetch({ deferredPut: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide(initial.id, "slide-1");
    });
    act(() => {
      result.current.setDeckSlides(initial.id, [
        initial.slides[0]!,
        { ...initial.slides[1]!, content: "<h1>Replaced two</h1>" },
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getFirstPutSignal()).toBeDefined();

    act(() => {
      result.current.deleteSlide(initial.id, "slide-1");
    });
    resolveDeferredPut();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    await act(async () => {
      await result.current.refreshOpenDeck(initial.id);
    });
    expect(
      result.current.getDeck(initial.id)?.slides.map((slide) => slide.id),
    ).toEqual(["slide-2"]);
    vi.useRealTimers();
  });

  it("retries the newest replacement after an older replacement fails", async () => {
    window.history.pushState({}, "", "/deck/replacement-retry-deck");
    const initial: Deck = {
      id: "replacement-retry-deck",
      title: "Replacement retry deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
        {
          id: "slide-3",
          content: "<h1>Three</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const {
      fetchMock,
      setAccessibleDeck,
      getFirstPutSignal,
      rejectDeferredPut,
    } = setupFetch({ deferredPut: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide(initial.id, "slide-1");
      result.current.setDeckSlides(initial.id, [
        initial.slides[0]!,
        initial.slides[1]!,
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getFirstPutSignal()).toBeDefined();

    act(() => {
      result.current.deleteSlide(initial.id, "slide-2");
      result.current.setDeckSlides(initial.id, [
        initial.slides[1]!,
        initial.slides[2]!,
      ]);
    });
    rejectDeferredPut();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.flushDeckSave(initial.id);
    });
    const saveCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        requestString(url).includes("/_agent-native/actions/save-deck") &&
        actionCallBody(init).deckId === initial.id,
    );
    expect(saveCalls).toHaveLength(2);

    setAccessibleDeck({
      ...initial,
      updatedAt: "2026-05-12T00:02:00.000Z",
    });
    await act(async () => {
      await result.current.refreshOpenDeck(initial.id);
    });
    expect(
      result.current.getDeck(initial.id)?.slides.map((slide) => slide.id),
    ).toEqual(["slide-2", "slide-3"]);
    vi.useRealTimers();
  });

  it("resets the retry budget for a newer replacement", async () => {
    window.history.pushState({}, "", "/deck/replacement-retry-budget-deck");
    const initial: Deck = {
      id: "replacement-retry-budget-deck",
      title: "Replacement retry budget deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { setAccessibleDeck, getPutAttempts } = setupFetch({
      putFailures: { deckId: initial.id, count: 3 },
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.setDeckSlides(initial.id, [
        { ...initial.slides[0]!, content: "<h1>Replacement one</h1>" },
        initial.slides[1]!,
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(getPutAttempts(initial.id)).toBe(2);

    act(() => {
      result.current.setDeckSlides(initial.id, [
        initial.slides[0]!,
        { ...initial.slides[1]!, content: "<h1>Replacement two</h1>" },
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await result.current.flushDeckSave(initial.id);
    });

    expect(getPutAttempts(initial.id)).toBe(4);
    expect(hasUnsavedDeckChanges(initial.id)).toBe(false);
    vi.useRealTimers();
  });

  it("clears tombstones omitted by a permanently failed replacement", async () => {
    window.history.pushState({}, "", "/deck/failed-replacement-deck");
    const initial: Deck = {
      id: "failed-replacement-deck",
      title: "Failed replacement deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { setAccessibleDeck, getPutAttempts } = setupFetch({
      putFailures: { deckId: initial.id, count: 3 },
    });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide(initial.id, "slide-1");
    });
    act(() => {
      result.current.setDeckSlides(initial.id, [
        { ...initial.slides[1]!, content: "<h1>Replacement two</h1>" },
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getPutAttempts(initial.id)).toBe(3);

    await act(async () => {
      await result.current.reloadDecks();
    });
    expect(
      result.current.getDeck(initial.id)?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1", "slide-2"]);
    vi.useRealTimers();
  });

  it("does not merge a slide omitted by a pending replacement", async () => {
    window.history.pushState({}, "", "/deck/pending-replacement-deck");
    const initial: Deck = {
      id: "pending-replacement-deck",
      title: "Pending replacement deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.setDeckSlides(initial.id, [initial.slides[0]!]);
    });
    await act(async () => {
      await result.current.refreshOpenDeck(initial.id);
    });

    expect(
      result.current.getDeck(initial.id)?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.useRealTimers();
  });

  it("allows a later authoritative re-add after a successful replacement omission", async () => {
    window.history.pushState({}, "", "/deck/replacement-omission-readd-deck");
    const initial: Deck = {
      id: "replacement-omission-readd-deck",
      title: "Replacement omission re-add deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        { id: "slide-1", content: "<h1>One</h1>", notes: "", layout: "title" },
        {
          id: "slide-2",
          content: "<h1>Two</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });

    vi.useFakeTimers();
    act(() => {
      result.current.deleteSlide(initial.id, "slide-2");
    });
    act(() => {
      result.current.setDeckSlides(initial.id, [
        { ...initial.slides[0]!, content: "<h1>Replacement one</h1>" },
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      await result.current.flushDeckSave(initial.id);
    });

    setAccessibleDeck({
      ...initial,
      updatedAt: "2099-01-01T00:00:00.000Z",
      slides: [
        initial.slides[0]!,
        { ...initial.slides[1]!, content: "<h1>Re-added</h1>" },
      ],
    });
    await act(async () => {
      await result.current.refreshOpenDeck(initial.id);
    });

    expect(
      result.current.getDeck(initial.id)?.slides.map((slide) => slide.id),
    ).toEqual(["slide-1", "slide-2"]);
    vi.useRealTimers();
  });

  it("waits for an in-flight granular save before restoring an authoritative version", async () => {
    window.history.pushState({}, "", "/deck/restore-patch-race-deck");
    const initial: Deck = {
      id: "restore-patch-race-deck",
      title: "Restore Patch Race Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    const restored: Deck = {
      ...initial,
      updatedAt: "2026-05-12T00:01:00.000Z",
      slides: [
        {
          ...initial.slides[0]!,
          content: "<h1>Restored version</h1>",
        },
      ],
    };
    const { setAccessibleDeck, resolveDeferredPatch, getFirstPatchSignal } =
      setupFetch({ deferredPatch: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck(initial.id)?.slides[0]?.content).toBe(
        "<h1>Before</h1>",
      ),
    );

    vi.useFakeTimers();
    act(() => {
      result.current.updateSlide(
        initial.id,
        "slide-1",
        { content: "<h1>Stale local edit</h1>" },
        { persistence: "immediate" },
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getFirstPatchSignal()).toBeDefined();

    let barrierSettled = false;
    const restoreBarrier = result.current.flushDeckSave(initial.id).then(() => {
      barrierSettled = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(barrierSettled).toBe(false);

    // History waits for this barrier before issuing restore-deck-version. The
    // server snapshot is changed only after the stale request has settled.
    resolveDeferredPatch();
    await act(async () => {
      await restoreBarrier;
    });
    expect(barrierSettled).toBe(true);
    expect(getFirstPatchSignal()?.aborted).toBe(false);

    setAccessibleDeck(restored);
    await act(async () => {
      await result.current.refreshOpenDeck(initial.id, {
        clearPendingWrites: true,
      });
    });
    expect(result.current.getDeck(initial.id)?.slides[0]?.content).toBe(
      "<h1>Restored version</h1>",
    );

    vi.useRealTimers();
  });

  it("aborts and ignores an in-flight save when restoring an authoritative version", async () => {
    window.history.pushState({}, "", "/deck/restore-race-deck");
    const initial: Deck = {
      id: "restore-race-deck",
      title: "Restore Race Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    const restored: Deck = {
      ...initial,
      updatedAt: "2026-05-12T00:01:00.000Z",
      slides: [
        {
          ...initial.slides[0]!,
          content: "<h1>Restored version</h1>",
        },
      ],
    };
    const {
      fetchMock,
      setAccessibleDeck,
      rejectDeferredPut,
      getFirstPutSignal,
    } = setupFetch({ deferredPut: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck(initial.id)?.slides[0]?.content).toBe(
        "<h1>Before</h1>",
      ),
    );

    vi.useFakeTimers();
    act(() => {
      result.current.setDeckSlides(initial.id, [
        {
          ...initial.slides[0]!,
          content: "<h1>Stale local edit</h1>",
        },
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getFirstPutSignal()).toBeDefined();

    setAccessibleDeck(restored);
    await act(async () => {
      await result.current.refreshOpenDeck(initial.id, {
        clearPendingWrites: true,
      });
    });
    expect(getFirstPutSignal()?.aborted).toBe(true);
    expect(result.current.getDeck(initial.id)?.slides[0]?.content).toBe(
      "<h1>Restored version</h1>",
    );

    // A transport can still reject after it observes the abort. That late
    // result must not resurrect the stale queue or schedule a retry.
    await act(async () => {
      rejectDeferredPut();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const saveCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        requestString(url).includes("/_agent-native/actions/save-deck") &&
        actionCallBody(init).deckId === initial.id,
    );
    expect(saveCalls).toHaveLength(1);
    expect(hasUncommittedDeckChanges(initial.id, new Set())).toBe(false);

    vi.useRealTimers();
  });

  it("reconciles remote slide content when the timestamp and slide count are unchanged", async () => {
    window.history.pushState({}, "", "/deck/same-timestamp-deck");
    const initial: Deck = {
      id: "same-timestamp-deck",
      title: "Same Timestamp Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(
        result.current.getDeck("same-timestamp-deck")?.slides[0]?.content,
      ).toBe("<h1>Before</h1>"),
    );

    setAccessibleDeck({
      ...initial,
      slides: [
        {
          ...initial.slides[0]!,
          content: "<h1>After agent edit</h1>",
        },
      ],
    });
    const source = MockEventSource.lastInstance!;
    await act(async () => {
      source.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "deck-changed",
            deckId: "same-timestamp-deck",
          }),
        }),
      );
    });

    await waitFor(() =>
      expect(
        result.current.getDeck("same-timestamp-deck")?.slides[0]?.content,
      ).toBe("<h1>After agent edit</h1>"),
    );
  });

  it("reconciles a deck-change event while a local edit is pending", async () => {
    window.history.pushState({}, "", "/deck/live-dirty-deck");
    const initial: Deck = {
      id: "live-dirty-deck",
      title: "Live Dirty Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Local draft</h1>",
          notes: "",
          layout: "title",
        },
      ],
    };
    const { setAccessibleDeck } = setupFetch();
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(result.current.getDeck("live-dirty-deck")?.slides).toHaveLength(1),
    );

    // The human is typing in slide-1. That — not a deck-wide dirty flag — is
    // what must hold the agent's copy of slide-1 back.
    act(() => {
      result.current.markDeckDirty("live-dirty-deck");
      markSlideEditingActive("live-dirty-deck", "slide-1");
    });
    setAccessibleDeck({
      ...initial,
      updatedAt: "2026-05-12T00:01:00.000Z",
      slides: [
        {
          ...initial.slides[0]!,
          content: "<h1>Agent rewrote local slide</h1>",
        },
        {
          id: "slide-2",
          content: "<h1>Agent added slide</h1>",
          notes: "",
          layout: "content",
        },
      ],
    });

    const source = MockEventSource.lastInstance!;
    await act(async () => {
      source.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "deck-changed",
            deckId: "live-dirty-deck",
          }),
        }),
      );
    });

    await waitFor(() =>
      expect(result.current.getDeck("live-dirty-deck")?.slides).toHaveLength(2),
    );
    const deck = result.current.getDeck("live-dirty-deck")!;
    expect(deck.slides[0]?.content).toBe("<h1>Local draft</h1>");
    expect(deck.slides[1]?.content).toBe("<h1>Agent added slide</h1>");

    // Once the user stops typing, the next reconcile delivers the edit that
    // was held back. Sync events never replay, so the poll has to heal this;
    // the reconcile is therefore idempotent rather than event-triggered once.
    act(() => {
      clearSlideEditingActive("live-dirty-deck", "slide-1");
    });
    await act(async () => {
      await result.current.reloadDecks();
    });
    await waitFor(() =>
      expect(
        result.current.getDeck("live-dirty-deck")?.slides[0]?.content,
      ).toBe("<h1>Agent rewrote local slide</h1>"),
    );
  });

  it("adopts a targeted agent edit while an unrelated local write is in flight", async () => {
    window.history.pushState({}, "", "/deck/targeted-dirty-deck");
    const initial: Deck = {
      id: "targeted-dirty-deck",
      title: "Targeted Dirty Deck",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<h1>Before</h1>",
          notes: "",
          layout: "title",
        },
        {
          id: "slide-2",
          content: "<h1>Second</h1>",
          notes: "",
          layout: "content",
        },
      ],
    };
    const { setAccessibleDeck, getFirstPatchSignal, resolveDeferredPatch } =
      setupFetch({ deferredPatch: true });
    const { result } = renderHook(() => useDecks(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    setAccessibleDeck(initial);
    await act(async () => {
      await result.current.reloadDecks();
    });
    act(() => {
      result.current.updateSlide(
        initial.id,
        "slide-2",
        { content: "<h1>Local pending</h1>" },
        { persistence: "immediate" },
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getFirstPatchSignal()).toBeDefined();

    setAccessibleDeck({
      ...initial,
      updatedAt: "2026-05-12T00:01:00.000Z",
      slides: [
        {
          ...initial.slides[0]!,
          content: "<h1>After agent edit</h1>",
        },
      ],
    });
    const source = MockEventSource.lastInstance!;
    await act(async () => {
      source.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "deck-changed",
            deckId: initial.id,
            slideId: "slide-1",
          }),
        }),
      );
    });

    await waitFor(() =>
      expect(result.current.getDeck(initial.id)?.slides[0]?.content).toBe(
        "<h1>After agent edit</h1>",
      ),
    );
    expect(result.current.getDeck(initial.id)?.slides[1]?.content).toBe(
      "<h1>Local pending</h1>",
    );
    resolveDeferredPatch();
  });

  describe("SSE reconnect and resync", () => {
    it("reconnects after a fatal SSE error and closes the old connection (no leak)", async () => {
      window.history.pushState({}, "", "/");
      setupFetch();
      const { result } = renderHook(() => useDecks(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      const first = MockEventSource.lastInstance;
      expect(first).toBeTruthy();

      vi.useFakeTimers();
      act(() => {
        first!.simulateFatalError();
      });

      // A fatal error (readyState CLOSED) is not retried by the browser —
      // our own reconnect must close the dead connection immediately...
      expect(first!.close).toHaveBeenCalled();
      // ...but must not hammer a new connection into existence right away.
      expect(MockEventSource.instances.length).toBe(1);

      // Just under the first backoff delay: still no reconnect.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(999);
      });
      expect(MockEventSource.instances.length).toBe(1);

      // Crossing the delay reconnects with a brand-new EventSource instance.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(MockEventSource.instances.length).toBe(2);
      expect(MockEventSource.instances[1]).not.toBe(first);
    });

    it("bounds SSE reconnect backoff at a maximum delay across repeated failures", async () => {
      window.history.pushState({}, "", "/");
      setupFetch();
      const { result } = renderHook(() => useDecks(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      vi.useFakeTimers();
      let current = MockEventSource.lastInstance!;
      // Base 1s, doubling, capped at 30s — the last two deltas repeat the cap.
      const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
      for (const delay of expectedDelays) {
        act(() => {
          current.simulateFatalError();
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay - 1);
        });
        const countBeforeCap = MockEventSource.instances.length;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(MockEventSource.instances.length).toBe(countBeforeCap + 1);
        current =
          MockEventSource.instances[MockEventSource.instances.length - 1]!;
      }
    });

    it("stops reconnect attempts after unmount", async () => {
      window.history.pushState({}, "", "/");
      setupFetch();
      const { result, unmount } = renderHook(() => useDecks(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      const first = MockEventSource.lastInstance!;
      vi.useFakeTimers();
      act(() => {
        first.simulateFatalError();
      });
      expect(first.close).toHaveBeenCalled();

      unmount();

      // Advance well past the reconnect delay and the backoff cap.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      // The pending reconnect timer was cleared by the effect's cleanup, so
      // no new connection was created after unmount.
      expect(MockEventSource.instances.length).toBe(1);
    });

    it("issues a full resync on reconnect, so slides added while disconnected appear in state", async () => {
      window.history.pushState({}, "", "/deck/resync-deck");
      const initial: Deck = {
        id: "resync-deck",
        title: "Resync Deck",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<h1>One</h1>",
            notes: "",
            layout: "title",
          },
        ],
      };
      const { setAccessibleDeck } = setupFetch();
      const { result } = renderHook(() => useDecks(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      setAccessibleDeck(initial);
      await act(async () => {
        await result.current.reloadDecks();
      });
      await waitFor(() =>
        expect(result.current.getDeck("resync-deck")?.slides.length).toBe(1),
      );

      const source = MockEventSource.lastInstance!;
      act(() => {
        source.simulateOpen();
      });

      // The agent adds a slide server-side WHILE this tab is about to lose
      // its SSE connection. notifyClients() is fire-and-forget with no
      // backlog, so no event for this write will ever reach a client that
      // reconnects after it was broadcast — only a resync recovers it.
      const withNewSlide: Deck = {
        ...initial,
        updatedAt: "2026-07-09T00:05:00.000Z",
        slides: [
          ...initial.slides,
          {
            id: "slide-2",
            content: "<h1>Added while disconnected</h1>",
            notes: "",
            layout: "content",
          },
        ],
      };
      setAccessibleDeck(withNewSlide);

      vi.useFakeTimers();
      act(() => {
        source.simulateFatalError();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      const reconnected =
        MockEventSource.instances[MockEventSource.instances.length - 1]!;
      expect(reconnected).not.toBe(source);

      // Switch back to real timers before using testing-library's `waitFor`,
      // which polls on its own timer and does not advance fake timers itself.
      vi.useRealTimers();

      act(() => {
        reconnected.simulateOpen();
      });

      await waitFor(() =>
        expect(result.current.getDeck("resync-deck")?.slides.length).toBe(2),
      );
      expect(result.current.getDeck("resync-deck")?.slides[1]?.content).toBe(
        "<h1>Added while disconnected</h1>",
      );
    });

    it("resync surfaces agent-added slides even when the deck is dirty, without clobbering local edits", async () => {
      // This is the regression test for the real production incident: the poll
      // and the resync used to bail entirely on `hasUncommittedDeckChanges`, so
      // a dirty (or wedged-save) deck stayed permanently blind to agent-added
      // slides. Here the deck is dirty at reconnect AND the server has both an
      // added slide and a conflicting edit to the existing slide.
      window.history.pushState({}, "", "/deck/dirty-deck");
      const initial: Deck = {
        id: "dirty-deck",
        title: "Dirty Deck",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<h1>Local one</h1>",
            notes: "",
            layout: "title",
          },
        ],
      };
      const { setAccessibleDeck } = setupFetch();
      const { result } = renderHook(() => useDecks(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      setAccessibleDeck(initial);
      await act(async () => {
        await result.current.reloadDecks();
      });
      await waitFor(() =>
        expect(result.current.getDeck("dirty-deck")?.slides.length).toBe(1),
      );

      // Human is mid-edit on slide-1: the exact state that used to suppress
      // the refetch. Only slide-1 is protected — a dirty deck is not a reason
      // to hide agent work on any other slide.
      act(() => {
        result.current.markDeckDirty("dirty-deck");
        markSlideEditingActive("dirty-deck", "slide-1");
      });

      const source = MockEventSource.lastInstance!;
      act(() => {
        source.simulateOpen();
      });

      // Agent adds slide-2 AND rewrites slide-1 server-side while we're dirty.
      const serverVersion: Deck = {
        ...initial,
        updatedAt: "2026-07-09T00:05:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<h1>SERVER rewrote one</h1>",
            notes: "",
            layout: "title",
          },
          {
            id: "slide-2",
            content: "<h1>Agent added</h1>",
            notes: "",
            layout: "content",
          },
        ],
      };
      setAccessibleDeck(serverVersion);

      vi.useFakeTimers();
      act(() => {
        source.simulateFatalError();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      const reconnected =
        MockEventSource.instances[MockEventSource.instances.length - 1]!;
      vi.useRealTimers();

      act(() => {
        reconnected.simulateOpen();
      });

      await waitFor(() =>
        expect(result.current.getDeck("dirty-deck")?.slides.length).toBe(2),
      );
      const deck = result.current.getDeck("dirty-deck")!;
      // Agent addition surfaced despite the dirty deck...
      expect(deck.slides[1]?.content).toBe("<h1>Agent added</h1>");
      // ...but the locally-edited slide-1 was NOT clobbered by server content.
      expect(deck.slides[0]?.content).toBe("<h1>Local one</h1>");
    });
  });

  describe("save-hang timeout drains inFlightSaves", () => {
    it("aborts a stalled full-replace PUT so inFlightSaves drains and the open deck refetches", async () => {
      window.history.pushState({}, "", "/deck/hang-deck");
      const initial: Deck = {
        id: "hang-deck",
        title: "Hang Deck",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<h1>One</h1>",
            notes: "",
            layout: "title",
          },
        ],
      };
      const { setAccessibleDeck } = setupFetch({ hangPut: true });
      const { result } = renderHook(() => useDecks(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      setAccessibleDeck(initial);
      await act(async () => {
        await result.current.reloadDecks();
      });
      await waitFor(() =>
        expect(result.current.getDeck("hang-deck")?.slides.length).toBe(1),
      );

      // Establish the initial SSE connection so a later reconnect is treated as
      // a RE-connect (which resyncs), not the first connect (which does not).
      const firstSource = MockEventSource.lastInstance!;
      act(() => {
        firstSource.simulateOpen();
      });

      vi.useFakeTimers();
      // A local edit via setDeckSlides enqueues the legacy full-replace
      // save-deck call. After the 500ms debounce it moves into inFlightSaves —
      // then hangs.
      act(() => {
        result.current.setDeckSlides("hang-deck", [
          {
            id: "slide-1",
            content: "<h1>Edited locally</h1>",
            notes: "",
            layout: "title",
          },
        ]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // In flight and hanging. Probe the pendingSaves/inFlightSaves branch of
      // hasUncommittedDeckChanges directly by passing an EMPTY dirty set.
      expect(hasUncommittedDeckChanges("hang-deck", new Set())).toBe(true);

      // Advance past the 60s action timeout and the bounded retry delay. The
      // failed batch remains queued, then the retry commits it before the save
      // state drains.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_250);
      });
      expect(hasUncommittedDeckChanges("hang-deck", new Set())).toBe(false);

      // With the leak drained, an agent-added slide must now reach the open
      // deck (it was permanently suppressed while inFlightSaves was wedged).
      const agentVersion: Deck = {
        ...initial,
        updatedAt: "2026-07-09T00:10:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<h1>Edited locally</h1>",
            notes: "",
            layout: "title",
          },
          {
            id: "slide-2",
            content: "<h1>Agent added post-hang</h1>",
            notes: "",
            layout: "content",
          },
        ],
      };
      setAccessibleDeck(agentVersion);

      act(() => {
        firstSource.simulateFatalError();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      const reconnected =
        MockEventSource.instances[MockEventSource.instances.length - 1]!;
      vi.useRealTimers();

      act(() => {
        reconnected.simulateOpen();
      });

      await waitFor(() =>
        expect(result.current.getDeck("hang-deck")?.slides.length).toBe(2),
      );
      expect(result.current.getDeck("hang-deck")?.slides[1]?.content).toBe(
        "<h1>Agent added post-hang</h1>",
      );
    });
  });

  describe("mergeServerAddedSlides", () => {
    const slide = (id: string, content: string): Slide => ({
      id,
      content,
      notes: "",
      layout: "content",
    });
    const deckOf = (slides: Slide[]): Deck => ({
      id: "d",
      title: "t",
      createdAt: "",
      updatedAt: "",
      slides,
    });

    it("adds server-only slides in server order without touching local content", () => {
      const local = deckOf([slide("a", "LOCAL a")]);
      const server = deckOf([slide("a", "SERVER a"), slide("b", "b")]);
      const merged = mergeServerAddedSlides(local, server);
      expect(merged.slides.map((s) => s.id)).toEqual(["a", "b"]);
      expect(merged.slides[0]?.content).toBe("LOCAL a"); // local preserved
      expect(merged.slides[1]?.content).toBe("b");
    });

    it("returns the same local reference when nothing was added", () => {
      const local = deckOf([slide("a", "a")]);
      const server = deckOf([slide("a", "SERVER a")]);
      expect(mergeServerAddedSlides(local, server)).toBe(local);
    });

    it("never drops a local-only (unsaved) slide", () => {
      const local = deckOf([slide("a", "a"), slide("local-only", "x")]);
      const server = deckOf([slide("a", "a"), slide("b", "b")]);
      const merged = mergeServerAddedSlides(local, server);
      expect([...merged.slides.map((s) => s.id)].sort()).toEqual(
        ["a", "b", "local-only"].sort(),
      );
    });
  });

  describe("mergeServerSlideUpdate", () => {
    const slide = (id: string, content: string): Slide => ({
      id,
      content,
      notes: "",
      layout: "content",
    });
    const deckOf = (slides: Slide[]): Deck => ({
      id: "dirty-deck",
      title: "t",
      createdAt: "",
      updatedAt: "",
      slides,
    });

    afterEach(() => {
      clearSlideEditingActive("dirty-deck", "a");
    });

    // The regression this guards: an agent edit used to be adopted only for
    // the single slide id carried in the SSE payload, so an edit announced
    // without one — patch-deck over several slides, or any fallback poll —
    // stayed invisible while the deck had unrelated local edits.
    it("adopts server content for every slide with no pending local write", () => {
      const local = deckOf([slide("a", "LOCAL a"), slide("b", "LOCAL b")]);
      const server = deckOf([slide("a", "AGENT a"), slide("b", "AGENT b")]);
      const merged = mergeServerSlideUpdate(local, server, "dirty-deck");
      expect(merged.slides.map((s) => s.content)).toEqual([
        "AGENT a",
        "AGENT b",
      ]);
    });

    it("holds back a slide the user is mid inline-edit", () => {
      markSlideEditingActive("dirty-deck", "a");
      const local = deckOf([slide("a", "TYPING a"), slide("b", "LOCAL b")]);
      const server = deckOf([slide("a", "AGENT a"), slide("b", "AGENT b")]);
      const merged = mergeServerSlideUpdate(local, server, "dirty-deck");
      expect(merged.slides.map((s) => s.content)).toEqual([
        "TYPING a",
        "AGENT b",
      ]);
    });

    // Runs on every poll, so an unchanged deck must not churn React state.
    it("returns the same local reference when the server matches", () => {
      const local = deckOf([slide("a", "a"), slide("b", "b")]);
      const server = deckOf([slide("a", "a"), slide("b", "b")]);
      expect(mergeServerSlideUpdate(local, server, "dirty-deck")).toBe(local);
    });

    // Response-ordering race: the GET was issued while slide "a" was mid-save,
    // so it carries the pre-save body even though the save has since landed and
    // nothing is pending any more. Adopting it would revert the user's edit.
    it("holds back a slide that was mid-write when the snapshot was requested", () => {
      markSlideEditingActive("dirty-deck", "a");
      const local = deckOf([slide("a", "SAVED a"), slide("b", "LOCAL b")]);
      const pendingAtReadStart = pendingWriteSlideIds(local);
      clearSlideEditingActive("dirty-deck", "a"); // the save landed

      const stale = deckOf([slide("a", "PRE-SAVE a"), slide("b", "AGENT b")]);
      const merged = mergeServerSlideUpdate(local, stale, "dirty-deck", {
        pendingAtReadStart,
      });
      expect(merged.slides.map((s) => s.content)).toEqual([
        "SAVED a",
        "AGENT b",
      ]);
    });
  });
});
