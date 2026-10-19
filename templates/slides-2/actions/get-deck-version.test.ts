import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, mocks } = vi.hoisted(() => {
  const state = {
    assertAccess: vi.fn(),
    ForbiddenError: class ForbiddenError extends Error {},
    version: null as null | Record<string, unknown>,
    whereConditions: [] as unknown[],
  };
  const db = {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn((condition: unknown) => {
          state.whereConditions.push(condition);
          return builder;
        }),
        limit: vi.fn(async () => (state.version ? [state.version] : [])),
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
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    deckVersions: {
      id: "version_id",
      deckId: "deck_id",
      ownerEmail: "owner_email",
    },
  },
}));

import action from "./get-deck-version.js";

describe("get-deck-version", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        data: JSON.stringify({ appId: "slides-2" }),
      },
    });
    mocks.version = {
      id: "version-1",
      deckId: "deck-1",
      ownerEmail: "owner@example.com",
      title: "Deck",
      changeLabel: "Saved",
      createdAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ appId: "slides-2", slides: [{ id: "slide-1" }] }),
    };
    mocks.whereConditions = [];
    db.select.mockClear();
  });

  it("does not query snapshots for an explicitly foreign deck", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        data: JSON.stringify({ appId: "slides" }),
      },
    });

    await expect(
      action.run({ deckId: "deck-1", versionId: "version-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects an explicitly foreign snapshot payload", async () => {
    mocks.version = {
      id: "version-1",
      deckId: "deck-1",
      ownerEmail: "owner@example.com",
      title: "Foreign snapshot",
      changeLabel: "Saved",
      createdAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ appId: "slides", slides: [] }),
    };

    await expect(
      action.run({ deckId: "deck-1", versionId: "version-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a markerless current deck before reading a snapshot", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        data: JSON.stringify({ slides: [] }),
      },
    });

    await expect(
      action.run({ deckId: "deck-1", versionId: "version-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects a markerless snapshot payload", async () => {
    mocks.version!.data = JSON.stringify({ slides: [{ id: "legacy-slide" }] });

    await expect(
      action.run({ deckId: "deck-1", versionId: "version-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("reads a snapshot only within viewer access and owner scope", async () => {
    expect(action.retrySafe).toBe(true);

    await action.run({ deckId: "deck-1", versionId: "version-1" });

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(mocks.whereConditions[0]).toEqual(
      expect.arrayContaining([
        { left: "version_id", right: "version-1" },
        { left: "deck_id", right: "deck-1" },
        { left: "owner_email", right: "owner@example.com" },
      ]),
    );
  });

  it("returns a typed not-found failure for a missing snapshot", async () => {
    mocks.version = null;

    await expect(
      action.run({ deckId: "deck-1", versionId: "missing" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_version_not_found",
    });
  });

  it("hides snapshots when deck access is denied", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new mocks.ForbiddenError("No access"),
    );

    await expect(
      action.run({ deckId: "private-deck", versionId: "version-1" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});
