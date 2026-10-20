import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  access: undefined as
    | { role: string; resource: Record<string, unknown> }
    | undefined,
  updatedFields: undefined as Record<string, unknown> | undefined,
}));
const mockNotifyClients = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: () => Promise.resolve(state.access),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => {
    const update = () => ({
      set: (fields: Record<string, unknown>) => ({
        where: async () => {
          state.updatedFields = fields;
          if (state.access) {
            state.access.resource = { ...state.access.resource, ...fields };
          }
          return { rowsAffected: 1 };
        },
      }),
    });
    return {
      update,
      insert: () => ({ values: async () => undefined }),
      transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ update }),
    };
  },
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      data: "decks.data",
      designSystemId: "decks.designSystemId",
      lastWriteClientId: "decks.lastWriteClientId",
      lastWriteClientSequence: "decks.lastWriteClientSequence",
      lastWriteRevision: "decks.lastWriteRevision",
      updatedAt: "decks.updatedAt",
    },
  },
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: mockNotifyClients,
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: vi.fn(),
  deckVersionContentSignature: (raw: unknown) => {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const clone = { ...(data as Record<string, unknown>) };
      delete clone.updatedAt;
      return JSON.stringify(clone);
    }
    return JSON.stringify(data);
  },
}));

vi.mock("./patch-deck", () => ({
  withDeckLock: (_deckId: string, callback: () => Promise<unknown>) =>
    callback(),
}));

vi.mock("./_deck-write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_deck-write.js")>();
  return {
    ...actual,
    assertDeckWriteApplied: (result: { rowsAffected: number }) => {
      if (result.rowsAffected !== 1) throw new Error("write failed");
    },
    assertDesignSystemReadable: () => Promise.resolve(),
    assertHumanReadableDeckTitle: () => {},
    assertValidAspectRatio: () => {},
    deckDesignSystemId: (deck: Record<string, unknown>) =>
      typeof deck.designSystemId === "string" && deck.designSystemId
        ? deck.designSystemId
        : null,
    deckRevisionWhere: () => ({}),
    deckTitle: (deck: Record<string, unknown>) =>
      typeof deck.title === "string" && deck.title ? deck.title : "Untitled",
    nextDeckRevision: () => "2026-05-12T00:00:00.001Z",
  };
});

import saveDeckAction from "./save-deck";

const existingResource = () => ({
  id: "deck-1",
  title: "Existing",
  ownerEmail: "owner@example.com",
  designSystemId: "brand-1",
  updatedAt: "2026-05-12T00:00:00.000Z",
  data: JSON.stringify({
    id: "deck-1",
    title: "Existing",
    designSystemId: "brand-1",
    slides: [{ id: "slide-1", content: "old", layoutFitRevision: "fit-1" }],
  }),
});

describe("save-deck design-system relation persistence", () => {
  beforeEach(() => {
    state.access = { role: "owner", resource: existingResource() };
    state.updatedFields = undefined;
    mockNotifyClients.mockClear();
  });

  it("persists an explicit null when an imported deck clears its design system", async () => {
    await saveDeckAction.run(
      {
        deckId: "deck-1",
        deck: {
          title: "Restored",
          designSystemId: null,
          slides: [{ id: "slide-1", content: "restored" }],
        },
      },
      {},
    );

    expect(state.updatedFields?.designSystemId).toBeNull();
  });

  it("preserves the relation when a full replacement omits the field", async () => {
    await saveDeckAction.run(
      {
        deckId: "deck-1",
        deck: {
          title: "Restored",
          slides: [{ id: "slide-1", content: "restored" }],
        },
      },
      {},
    );

    expect(state.updatedFields?.designSystemId).toBe("brand-1");
  });

  it("refuses a full replacement that stores rendered editor markup", async () => {
    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-1",
          deck: {
            title: "Existing",
            slides: [
              {
                id: "slide-1",
                content:
                  '<p data-builder-id="b-1" contenteditable="false">old</p>',
              },
            ],
          },
        },
        {},
      ),
    ).rejects.toMatchObject({ errorCode: "render_artifact_in_slide_content" });
    expect(state.updatedFields).toBeUndefined();
  });

  it("refuses to create a deck whose slides carry rendered editor markup", async () => {
    state.access = undefined;
    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-new",
          deck: {
            title: "New deck",
            slides: [
              {
                id: "slide-1",
                content: '<p data-src-i="slide-r1:0">New</p>',
              },
            ],
          },
        },
        {},
      ),
    ).rejects.toMatchObject({ errorCode: "render_artifact_in_slide_content" });
  });

  it("skips a full replacement when only updatedAt differs", async () => {
    const result = await saveDeckAction.run(
      {
        deckId: "deck-1",
        deck: {
          id: "deck-1",
          title: "Existing",
          designSystemId: "brand-1",
          updatedAt: "2026-05-12T00:01:00.000Z",
          slides: [
            { id: "slide-1", content: "old", layoutFitRevision: "fit-1" },
          ],
        },
      },
      {},
    );

    expect(result).toMatchObject({
      id: "deck-1",
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    expect(state.updatedFields).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects an older full replacement after a newer pagehide write", async () => {
    const expectedUpdatedAt = state.access!.resource.updatedAt as string;
    await saveDeckAction.run(
      {
        deckId: "deck-1",
        deck: {
          title: "Newest",
          slides: [{ id: "slide-1", content: "newest" }],
        },
        clientWrite: {
          clientId: "editor-tab",
          sequence: 2,
          expectedUpdatedAt,
        },
      },
      {},
    );

    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-1",
          deck: {
            title: "Older",
            slides: [{ id: "slide-1", content: "older" }],
          },
          clientWrite: {
            clientId: "editor-tab",
            sequence: 1,
            expectedUpdatedAt,
          },
        },
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(JSON.parse(state.access!.resource.data as string)).toMatchObject({
      title: "Newest",
      slides: [{ content: "newest" }],
    });
  });
});

describe("save-deck tracking", () => {
  const ctx = { caller: "frontend", runId: "run-1" } as never;

  beforeEach(() => {
    state.access = { role: "owner", resource: existingResource() };
    state.updatedFields = undefined;
    mockNotifyClients.mockClear();
    mockTrack.mockClear();
  });

  function trackedNames() {
    return mockTrack.mock.calls.map(([name]) => name);
  }

  it("emits nothing for a metadata-only save", async () => {
    await saveDeckAction.run(
      {
        deckId: "deck-1",
        deck: {
          title: "Renamed",
          designSystemId: "brand-1",
          aspectRatio: "4:3",
          slides: [
            { id: "slide-1", content: "old", layoutFitRevision: "fit-1" },
          ],
        },
      },
      ctx,
    );

    expect(state.updatedFields).toBeDefined();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("records nothing when a save re-inserts a deleted deck (undo restore)", async () => {
    state.access = undefined;
    await saveDeckAction.run(
      {
        deckId: "deck-restored",
        deck: {
          title: "Restored deck",
          slides: [{ id: "slide-1", content: "<p>Hello</p>" }],
          generationContext: { generationAttemptId: "attempt-1", mode: "new" },
        },
      },
      ctx,
    );

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("emits one deck_edited with the caller for a content save", async () => {
    await saveDeckAction.run(
      {
        deckId: "deck-1",
        deck: {
          title: "Existing",
          designSystemId: "brand-1",
          slides: [
            { id: "slide-1", content: "new" },
            { id: "slide-2", content: "added" },
          ],
        },
      },
      ctx,
    );

    expect(trackedNames()).toEqual(["deck_edited"]);
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      app_name: "slides",
      template_name: "slides",
      caller: "frontend",
      run_id: "run-1",
      output_id: "deck-1",
      output_type: "deck",
      edit_mode: "save_deck",
      change_kinds: ["content", "add_slide"],
      slides_changed: 2,
      slide_count: 2,
    });
  });

  it("emits deck_creation_started when a retry persists a new attempt id", async () => {
    state.access!.resource.data = JSON.stringify({
      ...JSON.parse(state.access!.resource.data as string),
      generationContext: {
        originalPrompt: "Quarterly review",
        generationAttemptId: "attempt-1",
        mode: "new",
        files: [],
      },
    });

    await saveDeckAction.run(
      {
        deckId: "deck-1",
        deck: {
          title: "Existing",
          designSystemId: "brand-1",
          slides: [
            { id: "slide-1", content: "old", layoutFitRevision: "fit-1" },
          ],
          generationContext: {
            originalPrompt: "Quarterly review",
            generationAttemptId: "attempt-2",
            mode: "new",
            files: [],
          },
        },
      },
      ctx,
    );

    expect(trackedNames()).toEqual(["deck_creation_started"]);
    const properties = mockTrack.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(properties).toMatchObject({
      generation_attempt_id: "attempt-2",
      is_retry: true,
      caller: "frontend",
    });
    expect(JSON.stringify(properties)).not.toContain("Quarterly");
  });
});
