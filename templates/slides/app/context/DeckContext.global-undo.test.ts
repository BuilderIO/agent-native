// @vitest-environment happy-dom
import { _resetSyncTransportRegistryForTests } from "@agent-native/core/client/use-db-sync";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: null }, isLoading: false }),
}));

import { toast } from "sonner";

import { DeckProvider, useDecks, type Deck, type Slide } from "./DeckContext";

function slide(id: string, over: Partial<Slide> = {}): Slide {
  return { id, content: `<p>${id}</p>`, notes: "", layout: "content", ...over };
}

function deck(slides: Slide[]): Deck {
  return {
    id: "deck-1",
    title: "Deck",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    slides,
  };
}

function contents(value: Deck | undefined): Record<string, string> {
  return Object.fromEntries(
    (value?.slides ?? []).map((entry) => [entry.id, entry.content]),
  );
}

describe("global undo after agent edits (repro)", () => {
  let serverDeck: Deck;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });

  beforeEach(() => {
    _resetSyncTransportRegistryForTests();
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.history.pushState({}, "", "/deck/deck-1");
    serverDeck = deck([slide("a"), slide("b")]);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const href =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.toString()
              : url.url;
        if (href.includes("/_agent-native/actions/list-decks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ count: 1, decks: [serverDeck] })),
          );
        }
        if (href.includes("/_agent-native/actions/get-deck")) {
          return Promise.resolve(new Response(JSON.stringify(serverDeck)));
        }
        if (href.includes("/_agent-native/actions/patch-deck")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            operations?: Array<{
              op: string;
              slideId?: string;
              fields?: Partial<Slide>;
            }>;
          };
          for (const op of body.operations ?? []) {
            if (op.op !== "patch-slide") continue;
            serverDeck = {
              ...serverDeck,
              slides: serverDeck.slides.map((entry) =>
                entry.id === op.slideId ? { ...entry, ...op.fields } : entry,
              ),
            };
          }
          return Promise.resolve(new Response(JSON.stringify({ ok: true })));
        }
        return Promise.resolve(new Response("{}"));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    _resetSyncTransportRegistryForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  async function renderDeck() {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(DeckProvider, { openDeckId: "deck-1", children }),
      );
    const rendered = renderHook(() => useDecks(), { wrapper });
    await waitFor(() =>
      expect(rendered.result.current.getDeck("deck-1")).toBeDefined(),
    );
    return rendered.result;
  }

  async function agentEdits(
    slideId: string,
    content: string,
    toolResult: Record<string, unknown> = {
      ok: true,
      deckId: "deck-1",
      slideId,
    },
  ) {
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "thread-1" },
        }),
      );
    });
    serverDeck = {
      ...serverDeck,
      updatedAt: "2026-07-02T00:00:00.000Z",
      slides: serverDeck.slides.map((entry) =>
        entry.id === slideId ? { ...entry, content } : entry,
      ),
    };
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: {
            completedSideEffect: true,
            tabId: "thread-1",
            result: JSON.stringify(toolResult),
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "thread-1" },
        }),
      );
    });
  }

  it("case 1: Cmd+Z after an agent edit reverts it", async () => {
    const result = await renderDeck();
    await agentEdits("b", "<p>agent</p>");
    await waitFor(() =>
      expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>agent</p>"),
    );

    act(() => result.current.undo("deck-1"));

    await waitFor(() =>
      expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>b</p>"),
    );
  });

  it("case 2: Cmd+Z after user edit then agent edit on the same field", async () => {
    const result = await renderDeck();
    act(() => {
      result.current.updateSlide("deck-1", "b", { content: "<p>user</p>" });
    });
    await waitFor(() => expect(contents(serverDeck).b).toBe("<p>user</p>"));

    await agentEdits("b", "<p>agent</p>");
    await waitFor(() =>
      expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>agent</p>"),
    );

    act(() => result.current.undo("deck-1"));

    await waitFor(() =>
      expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>user</p>"),
    );
  });

  it("silent no-op: Cmd+Z when the field already holds the undo value", async () => {
    const result = await renderDeck();
    act(() => {
      result.current.updateSlide("deck-1", "b", { content: "<p>user</p>" });
    });
    await waitFor(() => expect(contents(serverDeck).b).toBe("<p>user</p>"));

    await agentEdits("b", "<p>b</p>", { ok: true });
    await waitFor(() =>
      expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>b</p>"),
    );

    const toastError = vi.spyOn(toast, "error");
    act(() => result.current.undo("deck-1"));

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>b</p>");
  });
});
