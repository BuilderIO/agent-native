import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockCreateDeckVersionSnapshot = vi.fn();
const mockNotifyClients = vi.fn();
const mockWriteAppState = vi.fn();

const current = {
  id: "deck-1",
  title: "Deck",
  designSystemId: "system-1",
  updatedAt: "2026-09-03T00:00:01.000Z",
  ownerEmail: "owner@example.com",
  data: JSON.stringify({
    id: "deck-1",
    title: "Deck",
    designSystemId: "system-1",
    slides: [{ id: "slide-1", content: "same" }],
    updatedAt: "2026-09-03T00:00:01.000Z",
  }),
};

const version = {
  id: "version-1",
  deckId: "deck-1",
  ownerEmail: "owner@example.com",
  title: "Deck",
  data: JSON.stringify({
    id: "deck-1",
    title: "Deck",
    designSystemId: "system-1",
    slides: [{ id: "slide-1", content: "same" }],
    updatedAt: "2026-09-02T00:00:01.000Z",
  }),
};

const limitFn = vi.fn(async () => [version]);
const whereFn = vi.fn(() => ({ limit: limitFn }));
const fromFn = vi.fn(() => ({ where: whereFn }));
const selectFn = vi.fn(() => ({ from: fromFn }));
const mockDb = {
  select: selectFn,
  transaction: vi.fn(),
};

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      data: "decks.data",
      designSystemId: "decks.design_system_id",
      updatedAt: "decks.updated_at",
    },
    deckVersions: {
      id: "deck_versions.id",
      deckId: "deck_versions.deck_id",
      ownerEmail: "deck_versions.owner_email",
    },
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => {
    mockAssertAccess(...args);
    return Promise.resolve({ resource: current });
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
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

vi.mock("./_app-url.js", () => ({
  getDeckUrl: (deckId: string) => `/deck/${deckId}`,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

import action from "./restore-deck-version";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("restore-deck-version action", () => {
  it("skips a restore when the selected version already matches", async () => {
    await expect(
      action.run({ deckId: "deck-1", versionId: "version-1" }),
    ).resolves.toEqual({
      id: "deck-1",
      title: "Deck",
      slideCount: 1,
      restoredVersionId: "version-1",
      updatedAt: current.updatedAt,
      url: "/deck/deck-1",
      applied: false,
    });

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockNotifyClients).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
});
