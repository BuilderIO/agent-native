// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckProvider, useDecks } from "./DeckContext";

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

    if (href.endsWith("/api/decks")) {
      return Promise.resolve(new Response("[]", { status: 200 }));
    }

    if (href.includes("/api/decks/")) {
      return Promise.resolve(new Response("", { status: 404 }));
    }

    return Promise.resolve(new Response("", { status: 200 }));
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    resolveCreate: (response: Response) => resolveCreate(response),
  };
}

function deckFetchCalls(fetchMock: ReturnType<typeof setupFetch>["fetchMock"]) {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/api/decks/"),
  );
}

describe("DeckContext deck creation persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
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
});
