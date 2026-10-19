import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, tables } = vi.hoisted(() => ({
  mocks: {
    assertAccess: vi.fn(),
    notifyClients: vi.fn(),
    ForbiddenError: class ForbiddenError extends Error {},
  },
  tables: {
    deckShares: {
      principalId: "principalId",
      principalType: "principalType",
      resourceId: "resourceId",
    },
    deckVersions: { deckId: "deckId", ownerEmail: "ownerEmail" },
    slideComments: { deckId: "deckId" },
    decks: { id: "id", data: "data" },
  },
}));

let shareRows: Array<{ principalType: string; principalId: string }> = [];
let lockedDeckData = JSON.stringify({ appId: "slides-2" });

function selectBuilder() {
  let value: unknown[] = shareRows;
  const builder = {
    from: vi.fn((table: unknown) => {
      value =
        table === tables.decks
          ? [{ id: "deck-1", data: lockedDeckData }]
          : shareRows;
      return builder;
    }),
    where: vi.fn(() => builder),
    for: vi.fn(() => builder),
    then: (
      resolve: (nextValue: unknown[]) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve(value).then(resolve, reject),
  };
  return builder;
}

const mockDb = {
  select: vi.fn(() => selectBuilder()),
  delete: vi.fn((table: unknown) => {
    const rows = table === tables.decks ? [{ id: "deck-1" }] : [];
    const builder = {
      where: vi.fn(() => builder),
      returning: vi.fn(async () => rows),
      then: (
        resolve: (value: unknown[]) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  }),
  transaction: vi.fn(async (run: (tx: typeof mockDb) => Promise<unknown>) =>
    run(mockDb),
  ),
};

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), {
      name: "ActionContractError",
      actionContractError: true,
      errorCode: options.errorCode ?? "action_failed",
      statusCode: options.statusCode ?? 400,
    });
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
  getDb: () => mockDb,
  schema: tables,
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mocks.notifyClients(...args),
}));

import deleteDeck from "./delete-deck.js";

describe("deleteDeck", () => {
  beforeEach(() => {
    shareRows = [];
    lockedDeckData = JSON.stringify({ appId: "slides-2" });
    mocks.assertAccess.mockReset();
    mocks.notifyClients.mockReset();
    mockDb.select.mockClear();
    mockDb.delete.mockClear();
    mockDb.transaction.mockClear();
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "Owner@Example.com",
        orgId: "org-1",
        visibility: "private",
      },
    });
  });

  it("is available to the agent as the same guarded delete action", () => {
    expect(deleteDeck.agentTool).not.toBe(false);
  });

  it("does not read shares or delete a deck explicitly owned by another app", async () => {
    lockedDeckData = JSON.stringify({ appId: "slides" });

    await expect(deleteDeck.run({ id: "foreign-deck" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
      message: "Deck not found.",
    });

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("does not delete a markerless legacy deck", async () => {
    lockedDeckData = JSON.stringify({ title: "Legacy deck", slides: [] });

    await expect(deleteDeck.run({ id: "legacy-deck" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
      message: "Deck not found.",
    });

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("targets the owner and pre-delete share audience without leaking private org scope", async () => {
    shareRows = [
      { principalType: "user", principalId: "Sharee@Example.com" },
      { principalType: "org", principalId: "org-2" },
      { principalType: "group", principalId: "group-1" },
    ];

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.notifyClients.mock.calls).toEqual([
      ["deck-1", { type: "deck-deleted", owner: "owner@example.com" }],
      ["deck-1", { type: "deck-deleted", owner: "sharee@example.com" }],
      ["deck-1", { type: "deck-deleted", orgId: "org-2" }],
    ]);
    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.delete.mock.calls.map(([table]) => table)).toEqual([
      tables.deckShares,
      tables.deckVersions,
      tables.slideComments,
      tables.decks,
    ]);
  });

  it("includes the resource organization only for org-visible decks", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        visibility: "org",
      },
    });

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.notifyClients).toHaveBeenCalledWith("deck-1", {
      type: "deck-deleted",
      orgId: "org-1",
    });
  });

  it("broadcasts a public deletion tombstone to public viewers", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        visibility: "public",
      },
    });

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.notifyClients).toHaveBeenCalledWith("deck-1", {
      type: "deck-deleted",
      visibility: "public",
    });
  });

  it("maps denied access to the same typed not-found boundary", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new mocks.ForbiddenError("Not allowed"),
    );

    await expect(deleteDeck.run({ id: "private-deck" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
      message: "Deck not found.",
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
