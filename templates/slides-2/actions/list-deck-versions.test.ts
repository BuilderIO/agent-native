import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, mocks } = vi.hoisted(() => {
  const state = {
    assertAccess: vi.fn(),
    ForbiddenError: class ForbiddenError extends Error {},
    selectIndex: 0,
    versions: [] as Array<Record<string, unknown>>,
    beginningVersions: [] as Array<Record<string, unknown>>,
    whereConditions: [] as unknown[],
  };
  const db = {
    select: vi.fn(() => {
      const rows =
        state.selectIndex++ === 0 ? state.versions : state.beginningVersions;
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn((condition: unknown) => {
          state.whereConditions.push(condition);
          return builder;
        }),
        orderBy: vi.fn(() => builder),
        limit: vi.fn(async () => rows),
      };
      return builder;
    }),
  };
  return { db, mocks: state };
});

vi.mock("@agent-native/core", () => ({
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  ForbiddenError: mocks.ForbiddenError,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  asc: (column: unknown) => column,
  desc: (column: unknown) => column,
  eq: (left: unknown, right: unknown) => ({ left, right }),
  like: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    deckVersions: {
      id: "version_id",
      deckId: "deck_id",
      ownerEmail: "owner_email",
      title: "title",
      data: "data",
      changeLabel: "change_label",
      chatContext: "chat_context",
      createdAt: "created_at",
      changeGroup: "change_group",
    },
  },
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  parseDeckVersionChatContext: () => undefined,
}));

import action from "./list-deck-versions.js";

function version(data: string) {
  return {
    id: "version-1",
    deckId: "deck-1",
    title: "Deck",
    data,
    changeLabel: "Saved",
    chatContext: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("list-deck-versions", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        data: JSON.stringify({ appId: "slides-2" }),
      },
    });
    mocks.selectIndex = 0;
    mocks.whereConditions = [];
    mocks.versions = [
      version(JSON.stringify({ appId: "slides-2", slides: [] })),
    ];
    mocks.beginningVersions = [];
    db.select.mockClear();
  });

  it("does not list snapshots for an explicitly foreign deck", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        data: JSON.stringify({ appId: "slides" }),
      },
    });

    await expect(
      action.run({ deckId: "deck-1", limit: 10 }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects an explicitly foreign snapshot payload", async () => {
    mocks.versions = [version(JSON.stringify({ appId: "slides", slides: [] }))];

    await expect(
      action.run({ deckId: "deck-1", limit: 10 }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("rejects a markerless current deck before reading snapshots", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        data: JSON.stringify({ slides: [] }),
      },
    });

    await expect(
      action.run({ deckId: "deck-1", limit: 10 }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects a markerless snapshot payload", async () => {
    mocks.versions = [
      version(JSON.stringify({ slides: [{ id: "legacy-slide" }] })),
    ];

    await expect(
      action.run({ deckId: "deck-1", limit: 10 }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("scopes history to the viewer-accessible deck and its owner", async () => {
    expect(action.retrySafe).toBe(true);

    await action.run({ deckId: "deck-1", limit: 10 });

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(mocks.whereConditions[0]).toEqual(
      expect.arrayContaining([
        { left: "deck_id", right: "deck-1" },
        { left: "owner_email", right: "owner@example.com" },
      ]),
    );
  });

  it("hides history when deck access is denied", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new mocks.ForbiddenError("No access"),
    );

    await expect(
      action.run({ deckId: "private-deck", limit: 10 }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});
