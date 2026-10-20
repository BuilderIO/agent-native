import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  access: undefined as
    | { role: string; resource: Record<string, unknown> }
    | undefined,
  updatedFields: undefined as Record<string, unknown> | undefined,
  insertedFields: undefined as Record<string, unknown> | undefined,
  insertFailure: undefined as unknown,
}));
const mockNotifyClients = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockCreateDeckVersionSnapshot = vi.hoisted(() => vi.fn());
const mockWithSlideAssetReferencesLocked = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);

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
      insert: () => ({
        values: async (fields: Record<string, unknown>) => {
          if (state.insertFailure !== undefined) throw state.insertFailure;
          state.insertedFields = fields;
        },
      }),
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

vi.mock("../server/lib/deck-versions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/deck-versions.js")>();
  return {
    ...actual,
    createDeckVersionSnapshot: (...args: unknown[]) =>
      mockCreateDeckVersionSnapshot(...args),
  };
});

vi.mock("../server/lib/slide-asset-references.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../server/lib/slide-asset-references.js")
  >();
  return {
    ...actual,
    withSlideAssetReferencesLocked: (...args: unknown[]) =>
      mockWithSlideAssetReferencesLocked(...args),
  };
});

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

function runUnlockedWrite(...args: unknown[]): Promise<unknown> {
  const [connection, , , write] = args;
  return (write as (connection: unknown) => Promise<unknown>)(connection);
}

const existingResource = () => ({
  id: "deck-1",
  title: "Existing",
  ownerEmail: "owner@example.com",
  designSystemId: "brand-1",
  updatedAt: "2026-05-12T00:00:00.000Z",
  data: JSON.stringify({
    appId: "slides-2",
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
    state.insertedFields = undefined;
    state.insertFailure = undefined;
    mockWithSlideAssetReferencesLocked.mockReset();
    mockWithSlideAssetReferencesLocked.mockImplementation(runUnlockedWrite);
    mockCreateDeckVersionSnapshot.mockClear();
    mockNotifyClients.mockClear();
  });

  it("rejects an explicitly foreign stored deck before history or client writes", async () => {
    state.access!.resource.data = JSON.stringify({
      appId: "slides",
      title: "Other app deck",
      slides: [{ id: "slide-1", content: "old" }],
    });

    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-1",
          deck: {
            title: "Changed",
            slides: [{ id: "slide-1", content: "new" }],
          },
        },
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(state.updatedFields).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects a markerless stored deck before history or client writes", async () => {
    state.access!.resource.data = JSON.stringify({
      title: "Legacy deck",
      slides: [{ id: "slide-1", content: "old" }],
    });

    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-1",
          deck: {
            title: "Changed",
            slides: [{ id: "slide-1", content: "new" }],
          },
        },
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(state.updatedFields).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects an explicitly foreign replacement payload", async () => {
    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-1",
          deck: {
            appId: "slides",
            title: "Other app deck",
            slides: [],
          },
        },
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(state.updatedFields).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
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
    expect(JSON.parse(state.updatedFields?.data as string).appId).toBe(
      "slides-2",
    );
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

  it("preserves typed slide-asset failures while saving a new deck", async () => {
    state.access = undefined;
    const failure = Object.assign(
      new Error("One or more slide assets are unavailable to this deck."),
      { statusCode: 404, errorCode: "slide_asset_unavailable" },
    );
    mockWithSlideAssetReferencesLocked.mockRejectedValueOnce(failure);

    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-new",
          deck: { title: "New deck", slides: [] },
        },
        {},
      ),
    ).rejects.toBe(failure);
  });

  it("preserves plain lock failures while saving a new deck", async () => {
    state.access = undefined;
    const failure = new Error("Asset lock query failed");
    mockWithSlideAssetReferencesLocked.mockRejectedValueOnce(failure);

    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-new",
          deck: { title: "New deck", slides: [] },
        },
        {},
      ),
    ).rejects.toBe(failure);
    expect(state.insertedFields).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("preserves plain database failures while saving a new deck", async () => {
    state.access = undefined;
    const failure = new Error("Deck insert failed");
    state.insertFailure = failure;

    await expect(
      saveDeckAction.run(
        {
          deckId: "deck-new",
          deck: { title: "New deck", slides: [] },
        },
        {},
      ),
    ).rejects.toBe(failure);
    expect(state.insertedFields).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("normalizes an omitted Slides 2 marker before no-op comparison", async () => {
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
      appId: "slides-2",
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    expect(state.updatedFields).toBeUndefined();
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
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
    state.insertedFields = undefined;
    state.insertFailure = undefined;
    mockWithSlideAssetReferencesLocked.mockReset();
    mockWithSlideAssetReferencesLocked.mockImplementation(runUnlockedWrite);
    mockCreateDeckVersionSnapshot.mockClear();
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
    expect(JSON.parse(state.insertedFields?.data as string).appId).toBe(
      "slides-2",
    );
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
      app_name: "slides-2",
      template_name: "slides-2",
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
