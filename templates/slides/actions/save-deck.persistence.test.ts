import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  access: undefined as
    | { role: string; resource: Record<string, unknown> }
    | undefined,
  updatedFields: undefined as Record<string, unknown> | undefined,
}));
const mockNotifyClients = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: () => Promise.resolve(state.access),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        update: () => ({
          set: (fields: Record<string, unknown>) => ({
            where: async () => {
              state.updatedFields = fields;
              return { rowsAffected: 1 };
            },
          }),
        }),
      }),
  }),
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      data: "decks.data",
      designSystemId: "decks.designSystemId",
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

vi.mock("./_deck-write.js", () => ({
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
  deckHttpError: (statusCode: number, message: string) =>
    Object.assign(new Error(message), { statusCode }),
  deckRevisionWhere: () => ({}),
  deckTitle: (deck: Record<string, unknown>) =>
    typeof deck.title === "string" && deck.title ? deck.title : "Untitled",
  nextDeckRevision: () => "2026-05-12T00:00:00.001Z",
}));

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
});
