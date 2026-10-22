import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    decks: {
      id: "decks.id",
      data: "decks.data",
      updatedAt: "decks.updated_at",
    },
    deckShares: "deck_shares",
  };
  const selectChain = { from: vi.fn(), where: vi.fn() };
  return {
    schema,
    selectChain,
    db: { select: vi.fn() },
    queryRows: [] as Array<{ resourceId: string; sourceModifiedAt: string }>,
    queryFilter: undefined as unknown,
    deck: undefined as
      | {
          id: string;
          title: string;
          data: string;
          ownerEmail: string;
          updatedAt: string;
        }
      | undefined,
    accessFilter: vi.fn(),
    resolveAccess: vi.fn(),
    createDeckVersionSnapshot: vi.fn(),
    putPrivateBlob: vi.fn(),
    serializePrivateBlobHandle: vi.fn(),
    renderSafeNativeHtmlPreviews: vi.fn(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  inArray: (column: unknown, values: unknown[]) => ({
    type: "inArray",
    column,
    values,
  }),
  sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({
    type: "sql",
    parts: [...parts],
    values,
  }),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: (...args: unknown[]) => mocks.putPrivateBlob(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (...args: unknown[]) => mocks.accessFilter(...args),
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("@agent-native/creative-context/server", () => ({
  renderSafeNativeHtmlPreviews: (...args: unknown[]) =>
    mocks.renderSafeNativeHtmlPreviews(...args),
  serializePrivateBlobHandle: (...args: unknown[]) =>
    mocks.serializePrivateBlobHandle(...args),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => mocks.db,
  schema: mocks.schema,
}));

vi.mock("./deck-versions.js", () => ({
  createDeckVersionSnapshot: (...args: unknown[]) =>
    mocks.createDeckVersionSnapshot(...args),
}));

import { slides2DeckScope } from "../../shared/deck-scope.js";
import { nativeDeckCreativeContextAdapter } from "./native-creative-context.js";

const reference = {
  appId: "slides-2",
  resourceType: "deck",
  resourceId: "deck-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRows = [];
  mocks.queryFilter = undefined;
  mocks.deck = undefined;
  mocks.db.select.mockReturnValue(mocks.selectChain);
  mocks.selectChain.from.mockReturnValue(mocks.selectChain);
  mocks.selectChain.where.mockImplementation(async (filter: unknown) => {
    mocks.queryFilter = filter;
    return mocks.queryRows;
  });
  mocks.accessFilter.mockReturnValue({ type: "access" });
  mocks.resolveAccess.mockImplementation(async () =>
    mocks.deck ? { resource: mocks.deck, role: "owner" } : null,
  );
  mocks.createDeckVersionSnapshot.mockResolvedValue({ id: "version-1" });
  mocks.putPrivateBlob.mockResolvedValue({ id: "private-blob" });
  mocks.serializePrivateBlobHandle.mockReturnValue("private-handle");
  mocks.renderSafeNativeHtmlPreviews.mockResolvedValue([]);
});

describe("Slides 2 Creative Context deck adapter", () => {
  it("lists only accessible Slides 2 decks", async () => {
    const versions = [
      {
        resourceId: "deck-1",
        sourceModifiedAt: "2026-10-18T00:00:00.000Z",
      },
    ];
    mocks.queryRows = versions;

    await expect(
      nativeDeckCreativeContextAdapter.listResourceVersions?.(["deck-1"]),
    ).resolves.toEqual(versions);

    expect(mocks.accessFilter).toHaveBeenCalledWith(
      mocks.schema.decks,
      mocks.schema.deckShares,
    );
    const filter = mocks.queryFilter as {
      conditions: unknown[];
    };
    expect(filter.conditions).toContain(slides2DeckScope);
    expect(filter.conditions).toContainEqual({
      type: "inArray",
      column: mocks.schema.decks.id,
      values: ["deck-1"],
    });
  });

  it.each([
    ["markerless", { slides: [] }],
    ["foreign Slides", { appId: "slides", slides: [] }],
  ])(
    "rejects %s decks before snapshot or blob writes",
    async (_label, data) => {
      mocks.deck = {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify(data),
        ownerEmail: "owner@example.com",
        updatedAt: "2026-10-18T00:00:00.000Z",
      };

      await expect(
        nativeDeckCreativeContextAdapter.capture(reference),
      ).rejects.toThrow("Deck not found");

      expect(mocks.createDeckVersionSnapshot).not.toHaveBeenCalled();
      expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
    },
  );

  it("captures a current Slides 2 deck", async () => {
    mocks.deck = {
      id: "deck-1",
      title: "Quarterly Review",
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
      ownerEmail: "owner@example.com",
      updatedAt: "2026-10-18T00:00:00.000Z",
    };

    const result = await nativeDeckCreativeContextAdapter.capture(reference);

    expect(mocks.createDeckVersionSnapshot).toHaveBeenCalledOnce();
    expect(mocks.putPrivateBlob).toHaveBeenCalledOnce();
    expect(result.artifactKey).toBe("slides-2:deck:deck-1");
    expect(result.privateMetadata?.clone).toMatchObject({
      appId: "slides-2",
      resourceId: "deck-1",
      handle: { id: "private-blob" },
    });
  });
});
