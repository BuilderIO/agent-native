// @vitest-environment happy-dom
import { _resetSyncTransportRegistryForTests } from "@agent-native/core/client/use-db-sync";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: null }, isLoading: false }),
}));

import {
  agentWriteScopeFromToolResult,
  captureAgentBeforeSlides,
  deckBeforeAgentChange,
  DeckProvider,
  useDecks,
  type AgentChange,
  type AgentChangeBefore,
  type Deck,
  type Slide,
} from "./DeckContext";

function slide(id: string, over: Partial<Slide> = {}): Slide {
  return {
    id,
    content: `<p>${id}</p>`,
    notes: "",
    layout: "content",
    ...over,
  };
}

function deck(slides: Slide[], over: Partial<Deck> = {}): Deck {
  return {
    id: "deck-1",
    title: "Deck",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    slides,
    ...over,
  };
}

function contents(value: Deck | undefined): Record<string, string> {
  return Object.fromEntries(
    (value?.slides ?? []).map((entry) => [entry.id, entry.content]),
  );
}

describe("agentWriteScopeFromToolResult", () => {
  it("reads the deck, slides, and content hashes a write reported", () => {
    const scope = agentWriteScopeFromToolResult(
      `${JSON.stringify({
        ok: true,
        deckId: "deck-1",
        updatedSlideIds: ["a"],
        deletedSlideIds: ["b"],
        layoutFit: { slides: [{ slideId: "a", contentHash: "hash-a" }] },
      })}\n\nLoaded matching tool schemas for the next step`,
    );
    if (scope.kind !== "deck") throw new Error(`unexpected ${scope.kind}`);
    expect(scope.deckId).toBe("deck-1");
    expect(scope.slideIds).toEqual(["a", "b"]);
    expect([...scope.contentHashes]).toEqual([["a", "hash-a"]]);
  });

  it("keeps a deck write without slide ids deck-wide, and tells unreadable from unrelated", () => {
    expect(
      agentWriteScopeFromToolResult(JSON.stringify({ deckId: "deck-1" })),
    ).toMatchObject({ kind: "deck", slideIds: null });
    expect(agentWriteScopeFromToolResult('{"ok":true')).toEqual({
      kind: "unreadable",
    });
    expect(agentWriteScopeFromToolResult(JSON.stringify({ ok: true }))).toEqual(
      { kind: "none" },
    );
  });
});

describe("deckBeforeAgentChange", () => {
  it("puts back only the agent's slides and keeps everything else current", () => {
    const original = deck([slide("a"), slide("b"), slide("c")]);
    const afterAgent = deck([
      slide("a"),
      slide("b", { content: "<p>agent</p>" }),
      slide("new"),
    ]);
    const before = new Map<string, AgentChangeBefore>();
    captureAgentBeforeSlides(before, original, afterAgent);
    expect([...before.keys()].sort()).toEqual(["b", "c", "new"]);

    const current = deck([
      slide("a", { content: "<p>user</p>" }),
      slide("b", { content: "<p>agent</p>" }),
      slide("new"),
    ]);
    const reverted = deckBeforeAgentChange(current, before, null);
    expect(reverted?.slides.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(contents(reverted ?? undefined)).toEqual({
      a: "<p>user</p>",
      b: "<p>b</p>",
      c: "<p>c</p>",
    });
  });

  it("limits the revert to the slides the run's writes named", () => {
    const before = new Map<string, AgentChangeBefore>([
      ["a", { slide: slide("a"), index: 0 }],
      ["b", { slide: slide("b"), index: 1 }],
    ]);
    const current = deck([
      slide("a", { content: "<p>collaborator</p>" }),
      slide("b", { content: "<p>agent</p>" }),
    ]);
    expect(
      contents(
        deckBeforeAgentChange(current, before, new Set(["b"])) ?? undefined,
      ),
    ).toEqual({ a: "<p>collaborator</p>", b: "<p>b</p>" });
    expect(deckBeforeAgentChange(current, before, new Set(["z"]))).toBeNull();
  });
});

describe("agent change undo", () => {
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

  async function renderWithAgentEdit() {
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
    const changes: AgentChange[] = [];
    rendered.result.current.subscribeAgentChanges((change) =>
      changes.push(change),
    );

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
        entry.id === "b" ? { ...entry, content: "<p>agent</p>" } : entry,
      ),
    };
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: {
            completedSideEffect: true,
            tabId: "thread-1",
            result: JSON.stringify({
              ok: true,
              deckId: "deck-1",
              slideId: "b",
            }),
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "thread-1" },
        }),
      );
    });
    await waitFor(() => expect(changes).toHaveLength(1));
    const change = changes.at(0);
    if (!change) throw new Error("no agent change announced");
    return { result: rendered.result, change };
  }

  it("announces one change per run and undoes only the agent's slide", async () => {
    const { result, change } = await renderWithAgentEdit();
    expect(change).toMatchObject({ deckId: "deck-1", slideCount: 1 });
    expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>agent</p>");

    act(() => {
      result.current.updateSlide("deck-1", "a", { content: "<p>user</p>" });
    });
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.undoAgentChange("deck-1", change.token);
    });

    expect(outcome).toBe("undone");
    expect(contents(result.current.getDeck("deck-1"))).toEqual({
      a: "<p>user</p>",
      b: "<p>b</p>",
    });
    await waitFor(() => expect(contents(serverDeck).b).toBe("<p>b</p>"));
  });

  it("asks before replacing a later edit to the agent's slide", async () => {
    const { result, change } = await renderWithAgentEdit();
    act(() => {
      result.current.updateSlide("deck-1", "b", { content: "<p>user</p>" });
    });

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.undoAgentChange("deck-1", change.token);
    });
    expect(outcome).toBe("conflict");
    expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>user</p>");

    await act(async () => {
      outcome = await result.current.undoAgentChange("deck-1", change.token, {
        overwrite: true,
      });
    });
    expect(outcome).toBe("undone");
    expect(contents(result.current.getDeck("deck-1")).b).toBe("<p>b</p>");
  });
});
