// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertDeckClientWriteCurrent,
  deckClientWriteFields,
  nextDeckRevision,
  type DeckClientWrite,
} from "../../actions/_deck-write";
import { isMergeSafeDeckPatchOperations } from "../../shared/deck-write";

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: null }, isLoading: false }),
}));

const toastMessage = vi.hoisted(() => vi.fn());
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: Object.assign(toastMessage, actual.toast) };
});

import type { Deck, PatchDeckOp } from "./DeckContext";

type DeckContextModule = typeof import("./DeckContext");

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  close = vi.fn();
  constructor(public url: string) {}
}

/**
 * One deck row shared by every client, with the real revision check: a write
 * names the revision it expects, and only merge-safe patches may rebase.
 */
function sharedDeckServer(
  initial: Deck,
  applyOp: DeckContextModule["applyOpToDeck"],
) {
  const row: {
    deck: Deck;
    updatedAt: string | null;
    lastWriteClientId?: string | null;
    lastWriteClientSequence?: number | null;
    lastWriteRevision?: string | null;
  } = { deck: structuredClone(initial), updatedAt: initial.updatedAt };
  const commit = (deck: Deck, write?: DeckClientWrite) => {
    const updatedAt = nextDeckRevision(row.updatedAt);
    row.deck = { ...deck, updatedAt };
    row.updatedAt = updatedAt;
    Object.assign(row, deckClientWriteFields(write, updatedAt));
    return updatedAt;
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const conflict = (error: unknown) =>
    json(
      {
        error: "Deck changed",
        errorCode: (error as { errorCode?: string }).errorCode,
      },
      409,
    );
  const fetchMock = vi.fn(
    async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/get-actions-batch")) {
        const { requests } = JSON.parse(String(init?.body)) as {
          requests: Array<{ action: string; query: string }>;
        };
        const results = await Promise.all(
          requests.map(async ({ action, query }) => {
            const res: Response = await fetchMock(
              `/_agent-native/actions/${action}${query ? `?${query}` : ""}`,
              { method: "GET" },
            );
            const body: unknown = JSON.parse(await res.text());
            return res.status < 400
              ? { status: res.status, body }
              : { status: res.status, error: body };
          }),
        );
        return json({ results });
      }
      if (href.includes("/list-decks")) {
        return json({ count: 1, decks: [row.deck] });
      }
      if (href.includes("/get-deck")) return json(structuredClone(row.deck));
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        operations?: PatchDeckOp[];
        deck?: Deck;
        clientWrite?: DeckClientWrite;
      };
      if (href.includes("/patch-deck")) {
        const operations = body.operations ?? [];
        try {
          assertDeckClientWriteCurrent(row, row.deck.id, body.clientWrite, {
            allowRevisionMismatch: isMergeSafeDeckPatchOperations(operations),
          });
        } catch (error) {
          return conflict(error);
        }
        const missingSlideIds = operations.flatMap((operation) =>
          operation.op === "patch-slide" &&
          !row.deck.slides.some((slide) => slide.id === operation.slideId)
            ? [operation.slideId]
            : [],
        );
        if (missingSlideIds.length > 0) {
          return json(
            {
              error: "Slide is no longer in the deck",
              errorCode: "slide_not_found",
              details: { slideIds: missingSlideIds },
            },
            404,
          );
        }
        const updatedAt = commit(
          operations.reduce(applyOp, row.deck),
          body.clientWrite,
        );
        return json({ ok: true, updatedAt });
      }
      if (href.includes("/save-deck") && body.deck) {
        try {
          assertDeckClientWriteCurrent(row, row.deck.id, body.clientWrite);
        } catch (error) {
          return conflict(error);
        }
        commit(body.deck, body.clientWrite);
        return json(structuredClone(row.deck));
      }
      return json({});
    },
  );
  return { fetchMock, deck: () => row.deck };
}

/** A separate copy of the module, so each client keeps its own save queue. */
async function openClient() {
  vi.resetModules();
  const mod = (await import("./DeckContext")) as DeckContextModule;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(mod.DeckProvider, { realtimeEnabled: true, children }),
    );
  const { result } = renderHook(() => mod.useDecks(), { wrapper });
  return { mod, decks: () => result.current };
}

function deckSaveRequests(server: ReturnType<typeof sharedDeckServer>) {
  return server.fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/save-deck"),
  );
}

function slideIds(deck: Deck | undefined) {
  return deck?.slides.map((slide) => slide.id) ?? [];
}

function requireDeck(deck: Deck | undefined): Deck {
  if (!deck) throw new Error("deck is not loaded");
  return deck;
}

async function settle(ms = 900) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const initialDeck: Deck = {
  id: "shared-deck",
  title: "Shared deck",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  slides: [
    { id: "intro", content: "Intro", notes: "", layout: "title" },
    { id: "hidden", content: "Hide me", notes: "", layout: "content" },
    { id: "outro", content: "Outro", notes: "", layout: "content" },
  ],
};

describe("two people editing one deck", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.pushState({}, "", `/deck/${initialDeck.id}`);
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function openTwoClients() {
    const { applyOpToDeck } = await import("./DeckContext");
    const server = sharedDeckServer(initialDeck, applyOpToDeck);
    vi.stubGlobal("fetch", server.fetchMock);
    const david = await openClient();
    const ashley = await openClient();
    for (const client of [david, ashley]) {
      await waitFor(() =>
        expect(slideIds(client.decks().getDeck(initialDeck.id))).toHaveLength(
          3,
        ),
      );
    }
    return { server, david, ashley };
  }

  it("keeps a skipped slide when a collaborator saves between the skip and its write", async () => {
    const { server, david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().addSlide(initialDeck.id, "blank", 2);
    });
    act(() => {
      david.decks().updateDeck(initialDeck.id, { title: "Renamed" });
      david
        .decks()
        .updateSlides(initialDeck.id, [
          { slideId: "hidden", updates: { skipped: true } },
        ]);
    });
    await settle();

    expect(david.mod.getDeckSaveError(initialDeck.id)).toBeUndefined();
    const saved = server.deck();
    expect(saved.title).toBe("Renamed");
    expect(saved.slides.find((slide) => slide.id === "hidden")).toMatchObject({
      skipped: true,
    });
    expect(saved.slides).toHaveLength(4);

    await act(async () => {
      await ashley.decks().refreshOpenDeck(initialDeck.id);
    });
    expect(
      ashley
        .decks()
        .getDeck(initialDeck.id)
        ?.slides.find((slide) => slide.id === "hidden"),
    ).toMatchObject({ skipped: true });
  });

  it("does not rebase a deck field both people changed", async () => {
    const { server, david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().updateDeck(initialDeck.id, { title: "Ashley's title" });
    });
    await settle();
    act(() => {
      david.decks().updateDeck(initialDeck.id, { title: "David's title" });
    });
    await settle();

    expect(server.deck().title).toBe("Ashley's title");
    expect(david.mod.getDeckSaveError(initialDeck.id)).toMatchObject({
      status: 409,
      errorCode: "deck_revision_conflict",
    });
  });

  it("holds a whole-deck save that would delete a slide a collaborator added", async () => {
    const { server, david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().addSlide(initialDeck.id, "blank", 2);
    });
    await settle();
    const ashleySlideId = slideIds(server.deck()).at(-1);
    if (!ashleySlideId) throw new Error("Ashley's slide was not saved");

    // David's read lands while his own edit is mid-save, so his copy of the
    // deck does not take Ashley's slide yet; the read still moves his
    // client to the latest revision.
    let read: Promise<unknown> = Promise.resolve();
    act(() => {
      read = david.decks().refreshOpenDeck(initialDeck.id);
      david
        .decks()
        .updateSlides(initialDeck.id, [
          { slideId: "hidden", updates: { skipped: true } },
        ]);
    });
    await act(async () => {
      await read;
    });
    const davidsCopy = requireDeck(david.decks().getDeck(initialDeck.id));
    expect(slideIds(davidsCopy)).not.toContain(ashleySlideId);

    act(() => {
      david.decks().setDeckSlides(initialDeck.id, davidsCopy.slides, {
        persistence: "immediate",
        forcePersistence: true,
      });
    });
    await settle();

    expect(slideIds(server.deck())).toContain(ashleySlideId);
    expect(slideIds(server.deck())).toContain("hidden");
    expect(david.mod.getDeckSaveError(initialDeck.id)).toMatchObject({
      errorCode: "slide_content_conflict",
    });
  });

  it("keeps a collaborator's title when a whole-deck save did not change it", async () => {
    const { server, david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().updateDeck(initialDeck.id, { title: "Ashley's title" });
    });
    await settle();

    const davidsCopy = requireDeck(david.decks().getDeck(initialDeck.id));
    expect(davidsCopy.title).toBe(initialDeck.title);
    act(() => {
      david.decks().setDeckSlides(initialDeck.id, davidsCopy.slides, {
        persistence: "immediate",
        forcePersistence: true,
      });
    });
    await settle();

    expect(david.mod.getDeckSaveError(initialDeck.id)).toBeUndefined();
    expect(server.deck().title).toBe("Ashley's title");
  });

  it("sends a whole-deck save once when it starts behind a collaborator's change", async () => {
    const { server, david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().updateDeck(initialDeck.id, { title: "Ashley's title" });
    });
    await waitFor(() => expect(server.deck().title).toBe("Ashley's title"));

    // David saves before his client has seen Ashley's revision.
    const davidsCopy = requireDeck(david.decks().getDeck(initialDeck.id));
    expect(davidsCopy.title).toBe(initialDeck.title);
    const savesBefore = deckSaveRequests(server).length;
    act(() => {
      david.decks().setDeckSlides(initialDeck.id, davidsCopy.slides, {
        persistence: "immediate",
        forcePersistence: true,
      });
    });
    await settle();

    expect(david.mod.getDeckSaveError(initialDeck.id)).toBeUndefined();
    expect(server.deck().title).toBe("Ashley's title");
    expect(deckSaveRequests(server).length - savesBefore).toBe(1);
  });

  it("holds a whole-deck save that changes a title a collaborator also changed", async () => {
    const { server, david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().updateDeck(initialDeck.id, { title: "Ashley's title" });
    });
    await settle();

    const davidsCopy = requireDeck(david.decks().getDeck(initialDeck.id));
    act(() => {
      david.decks().setDeckSlides(initialDeck.id, davidsCopy.slides, {
        deckFields: { title: "David's title" },
        persistence: "immediate",
        forcePersistence: true,
      });
    });
    await settle();

    expect(server.deck().title).toBe("Ashley's title");
    // A title collision is a deck conflict, not a conflict on every slide.
    expect(david.mod.getDeckSaveError(initialDeck.id)).toMatchObject({
      errorCode: "deck_revision_conflict",
    });
    expect(david.mod.getDeckContentConflicts(initialDeck.id)).toEqual([]);
  });

  it("keeps a held title collision a deck conflict after another edit", async () => {
    const { david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().updateDeck(initialDeck.id, { title: "Ashley's title" });
    });
    await settle();

    const davidsCopy = requireDeck(david.decks().getDeck(initialDeck.id));
    act(() => {
      david.decks().setDeckSlides(initialDeck.id, davidsCopy.slides, {
        deckFields: { title: "David's title" },
        persistence: "immediate",
        forcePersistence: true,
      });
    });
    await settle();
    expect(david.mod.getDeckContentConflicts(initialDeck.id)).toEqual([]);

    act(() => {
      david.decks().updateSlide(initialDeck.id, "outro", { notes: "Close" });
    });
    await settle();

    expect(david.mod.getDeckSaveError(initialDeck.id)).toMatchObject({
      errorCode: "deck_revision_conflict",
    });
    expect(david.mod.getDeckContentConflicts(initialDeck.id)).toEqual([]);
  });

  it("keeps a collaborator's star when a whole-deck save did not change it", async () => {
    const { server, david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().updateDeck(initialDeck.id, { starred: true });
    });
    await settle();

    const davidsCopy = requireDeck(david.decks().getDeck(initialDeck.id));
    expect(davidsCopy.starred).toBeFalsy();
    act(() => {
      david.decks().setDeckSlides(initialDeck.id, davidsCopy.slides, {
        persistence: "immediate",
        forcePersistence: true,
      });
    });
    await settle();

    expect(david.mod.getDeckSaveError(initialDeck.id)).toBeUndefined();
    expect(server.deck().starred).toBe(true);
  });

  it("tells the editor plainly when a collaborator deleted the slide it was skipping", async () => {
    const { server, david, ashley } = await openTwoClients();

    act(() => {
      ashley.decks().deleteSlide(initialDeck.id, "hidden");
      david
        .decks()
        .updateSlides(initialDeck.id, [
          { slideId: "hidden", updates: { skipped: true } },
        ]);
      david.decks().updateSlide(initialDeck.id, "intro", { notes: "Kept" });
    });
    await settle(1500);

    expect(david.mod.getDeckSaveError(initialDeck.id)).toBeUndefined();
    expect(slideIds(server.deck())).toEqual(["intro", "outro"]);
    expect(server.deck().slides.at(0)).toMatchObject({ notes: "Kept" });
    expect(toastMessage).toHaveBeenCalledWith(
      expect.stringMatching(/slide ?deleted ?elsewhere|deleted a slide/i),
    );
    await waitFor(() =>
      expect(slideIds(david.decks().getDeck(initialDeck.id))).toEqual([
        "intro",
        "outro",
      ]),
    );
  });
});
