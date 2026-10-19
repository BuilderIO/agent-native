import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, tables, db } = vi.hoisted(() => {
  const mocks = {
    accessFilter: vi.fn(() => "deck-access-filter"),
    assertAccess: vi.fn(),
    resolveAccess: vi.fn(),
    deckWhere: vi.fn(),
    deckData: JSON.stringify({ appId: "slides-2", slides: [] }) as string,
  };
  const tables = {
    deckShares: { resourceId: "deckShares.resourceId" },
    decks: {
      id: "decks.id",
      designSystemId: "decks.designSystemId",
      updatedAt: "decks.updatedAt",
      data: "decks.data",
    },
    designSystemShares: { resourceId: "designSystemShares.resourceId" },
    designSystems: { id: "designSystems.id" },
  };
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          if (table === tables.decks) mocks.deckWhere(condition);
          return Promise.resolve(
            table === tables.decks
              ? [
                  {
                    id: "visible-deck",
                    data: mocks.deckData,
                    designSystemId: "design-system-1",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  },
                ]
              : [],
          );
        },
      }),
    })),
    transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        delete: () => ({ where: async () => [] }),
      }),
    ),
  };
  return { mocks, tables, db };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (...args: unknown[]) => mocks.accessFilter(...args),
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (column: unknown) => ({ desc: column }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  isNull: (column: unknown) => ({ isNull: column }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: tables,
}));

vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_deckId: string, run: () => Promise<unknown>) => run(),
}));

import deleteDesignSystem from "./delete-design-system.js";

describe("delete-design-system linked deck access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue({
      resource: {
        id: "design-system-1",
        ownerEmail: "owner@example.com",
        isDefault: false,
      },
    });
    mocks.resolveAccess.mockResolvedValue(null);
    mocks.deckData = JSON.stringify({ appId: "slides-2", slides: [] });
  });

  it("advertises the agent-supported patch-deck unlink path", () => {
    expect(deleteDesignSystem.description).toContain(
      "patch-deck using designSystemId: null",
    );
    expect(deleteDesignSystem.description).not.toContain(
      "does not expose designSystemId",
    );
  });

  it("scopes linked deck discovery to decks visible to the caller", async () => {
    const result = await deleteDesignSystem.run({ id: "design-system-1" });

    expect(mocks.accessFilter).toHaveBeenCalledWith(
      tables.decks,
      tables.deckShares,
    );
    expect(mocks.deckWhere).toHaveBeenCalledWith({
      and: [
        { eq: [tables.decks.designSystemId, "design-system-1"] },
        "deck-access-filter",
      ],
    });
    expect(result).toMatchObject({
      deleted: true,
      decksSkippedForAccess: ["visible-deck"],
    });
  });

  it("rejects a foreign app-linked deck before deleting the design system", async () => {
    mocks.deckData = JSON.stringify({ appId: "slides", slides: [] });

    await expect(
      deleteDesignSystem.run({ id: "design-system-1" }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "deck_not_found" });

    expect(db.transaction).not.toHaveBeenCalled();
  });
});
