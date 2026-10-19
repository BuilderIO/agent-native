import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, mocks } = vi.hoisted(() => {
  const state = {
    assertAccess: vi.fn(),
    row: {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
    } as null | { id: string; updatedAt: string; data: string },
    readSlideDesignTokens: vi.fn((..._args: unknown[]) => ({ accent: "blue" })),
  };
  const db = {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => (state.row ? [state.row] : [])),
      };
      return builder;
    }),
  };
  return { db, mocks: state };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    decks: { id: "deck_id", data: "data", updatedAt: "updated_at" },
  },
}));

vi.mock("../shared/slide-design-tokens.js", () => ({
  readSlideDesignTokens: (...args: unknown[]) =>
    mocks.readSlideDesignTokens(...args),
}));

import action from "./get-deck-design-tokens.js";

describe("get-deck-design-tokens", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({});
    mocks.row = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
    };
    mocks.readSlideDesignTokens.mockClear();
    db.select.mockClear();
  });

  it("rejects an explicitly foreign deck before returning theme tokens", async () => {
    mocks.row!.data = JSON.stringify({
      appId: "slides",
      slides: [{ id: "slide-1" }],
    });

    await expect(action.run({ deckId: "deck-1" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
    });
    expect(mocks.readSlideDesignTokens).not.toHaveBeenCalled();
  });

  it("rejects markerless legacy deck data", async () => {
    mocks.row!.data = JSON.stringify({ slides: [] });

    await expect(action.run({ deckId: "deck-1" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
    });
    expect(mocks.readSlideDesignTokens).not.toHaveBeenCalled();
  });
});
