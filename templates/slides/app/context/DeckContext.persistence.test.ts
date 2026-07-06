// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeckProvider, useDecks, type Deck, type Slide } from "./DeckContext";

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {}
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(DeckProvider, null, children);
}

function setupFetch() {
  let resolveCreate: (response: Response) => void = () => {};
  let accessibleDeck: Deck | null = null;
  const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const href =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

    if (init?.method === "POST" && href.endsWith("/api/decks")) {
      return new Promise<Response>((resolve) => {
        resolveCreate = resolve;
      });
    }

    if (href.includes("/_agent-native/actions/list-decks")) {
      return Promise.resolve(
        new Response(JSON.stringify({ count: 0, decks: [] }), {
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
});
