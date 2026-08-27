import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, tables } = vi.hoisted(() => ({
  mocks: {
    assertAccess: vi.fn(),
    notifyClients: vi.fn(),
  },
  tables: {
    deckShares: {
      principalId: "principalId",
      principalType: "principalType",
      resourceId: "resourceId",
    },
    deckVersions: { deckId: "deckId", ownerEmail: "ownerEmail" },
    decks: { id: "id" },
  },
}));

let shareRows: Array<{ principalType: string; principalId: string }> = [];

function resolvedBuilder<T>(value: T) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    then: (
      resolve: (value: T) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve(value).then(resolve, reject),
  };
  return builder;
}

const mockDb = {
  select: vi.fn(() => resolvedBuilder(shareRows)),
  transaction: async (run: (tx: any) => unknown) => run(mockDb),
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
};

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  ForbiddenError: class ForbiddenError extends Error {},
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

vi.mock("./_deck-write.js", () => ({
  deckHttpError: (status: number, message: string) =>
    Object.assign(new Error(message), { statusCode: status }),
}));
vi.mock("../server/lib/outbound-webhooks.js", () => ({
  enqueueWebhookEvent: vi.fn(async () => []),
  dispatchWebhookDeliveries: vi.fn(async () => undefined),
}));

import deleteDeck from "./delete-deck.js";

describe("deleteDeck", () => {
  beforeEach(() => {
    shareRows = [];
    mocks.assertAccess.mockReset();
    mocks.notifyClients.mockReset();
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "Owner@Example.com",
        orgId: "org-1",
        visibility: "private",
      },
    });
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
});
