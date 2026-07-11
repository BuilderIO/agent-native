// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeckProvider,
  hasUncommittedDeckChanges,
  mergeServerAddedSlides,
  useDecks,
  type Deck,
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

function wrapper({ children }: { children: ReactNode }) {
  return createElement(DeckProvider, null, children);
}

function setupFetch(options?: { hangPut?: boolean; failDeckList?: boolean }) {
  let resolveCreate: (response: Response) => void = () => {};
  let accessibleDeck: Deck | null = null;
  const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const href =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

    // Legacy full-replace PUT. When `hangPut` is set, the request never
    // resolves on its own — it only rejects when its AbortSignal fires, which
    // is exactly what `fetchWithTimeout` does after the timeout. This lets a
    // test prove the timeout drains `inFlightSaves` instead of wedging it.
    if (init?.method === "PUT" && href.includes("/api/decks/")) {
      if (options?.hangPut) {
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
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    }

    if (init?.method === "POST" && href.endsWith("/api/decks")) {
      return new Promise<Response>((resolve) => {
        resolveCreate = resolve;
      });
    }

    if (href.includes("/_agent-native/actions/list-decks")) {
      if (options?.failDeckList) {
        return Promise.resolve(
          new Response("Gateway timeout", { status: 504 }),
        );
      }
      const decks = accessibleDeck ? [accessibleDeck] : [];
      return Promise.resolve(
        new Response(JSON.stringify({ count: decks.length, decks }), {
          status: 200,
        }),
      );
    }

    if (href.includes("/_agent-native/actions/get-deck")) {
      if (accessibleDeck) {
        return Promise.resolve(
          new Response(JSON.stringify(accessibleDeck), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }

    if (href.includes("/_agent-native/actions/patch-deck")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    }

    if (href.endsWith("/api/decks")) {
      return Promise.resolve(new Response("[]", { status: 200 }));
    }

    if (href.includes("/api/decks/")) {
      if (accessibleDeck) {
        return Promise.resolve(
          new Response(JSON.stringify(accessibleDeck), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }

    return Promise.resolve(new Response("", { status: 200 }));
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    resolveCreate: (response: Response) => resolveCreate(response),
    setAccessibleDeck: (deck: Deck) => {
      accessibleDeck = deck;
    },
  };
}

function deckFetchCalls(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/_agent-native/actions/get-deck"),
  );
}

describe("DeckContext deck creation persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

    await expect(persisted).resolves.toBe(true);
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

    await expect(persisted).resolves.toBe(false);
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
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes(`/api/decks/${deckId}`) &&
          init?.method === "DELETE",
      ),
    ).toBe(false);

    resolveCreate(new Response("", { status: 200 }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes(`/api/decks/${deckId}`) &&
            init?.method === "DELETE",
        ),
      ).toBe(true),
    );
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
        String(url).includes(`/api/decks/${deckId}`) && init?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse(String(putCall?.[1]?.body)).slides[0].content).toBe(
      "<div>Generated</div>",
    );

    const patchCall = fetchMock.mock.calls.find(([url, init]) => {
      if (!String(url).includes("/_agent-native/actions/patch-deck")) {
        return false;
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        deckId?: string;
      };
      return body.deckId === deckId;
    });
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
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
    let firstReload = Promise.resolve();
    act(() => {
      firstReload = result.current.reloadDecks();
    });
    await waitFor(() => expect(firstDeckRequestStarted).toBe(true));

    window.history.pushState({}, "", "/deck/second-deck");
    await act(async () => {
      await result.current.reloadDecks();
    });
    expect(result.current.getDeck("second-deck")?.title).toBe("Second Deck");

    await act(async () => {
      resolveFirstDeck(
        new Response(JSON.stringify(firstDeck), { status: 200 }),
      );
      await firstReload;
    });

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
        current = MockEventSource.instances.at(-1)!;
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
      const reconnected = MockEventSource.instances.at(-1)!;
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

      // Human is mid-edit: the exact state that used to suppress the refetch.
      act(() => {
        result.current.markDeckDirty("dirty-deck");
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
      const reconnected = MockEventSource.instances.at(-1)!;
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
      // A local edit via setDeckSlides enqueues the legacy full-replace PUT.
      // After the 500ms debounce it moves into inFlightSaves — then hangs.
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

      // Advance past the 60s raw-fetch timeout: the AbortController fires, the
      // PUT rejects, and the save's `finally` deletes the inFlightSaves entry.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
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
      const reconnected = MockEventSource.instances.at(-1)!;
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
});
