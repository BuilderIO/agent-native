import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, mocks, state } = vi.hoisted(() => {
  const state = {
    row: null as null | { data: string; updatedAt: string | null },
    rowsAffected: 1,
    updateSet: undefined as
      | { designSystemId?: string; updatedAt?: string }
      | undefined,
    updateWhere: undefined as unknown,
  };
  const db = {
    select: vi.fn(),
    update: vi.fn(),
  };
  db.select.mockImplementation(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn(async () => (state.row ? [state.row] : [])),
    };
    return builder;
  });
  db.update.mockImplementation(() => ({
    set: (values: { designSystemId?: string; updatedAt?: string }) => {
      state.updateSet = values;
      return {
        where: async (condition: unknown) => {
          state.updateWhere = condition;
          if (state.rowsAffected === 1 && state.row) {
            state.row = { ...state.row, ...values };
          }
          return { rowsAffected: state.rowsAffected };
        },
      };
    },
  }));
  return {
    db,
    state,
    mocks: {
      assertAccess: vi.fn(),
      notifyClients: vi.fn(),
    },
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  isActionContractError: (error: unknown) =>
    Boolean(
      error &&
      typeof error === "object" &&
      (error as { actionContractError?: unknown }).actionContractError === true,
    ),
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), {
      actionContractError: true,
      errorCode: details.errorCode ?? "action_failed",
      statusCode: details.statusCode ?? 400,
      ...details,
    });
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    decks: {
      id: "decks.id",
      designSystemId: "decks.designSystemId",
      data: "decks.data",
      updatedAt: "decks.updatedAt",
    },
  },
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mocks.notifyClients(...args),
}));

import action from "./apply-design-system.js";

const initialUpdatedAt = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  state.rowsAffected = 1;
  state.updateSet = undefined;
  state.updateWhere = undefined;
  state.row = {
    updatedAt: initialUpdatedAt,
    data: JSON.stringify({
      appId: "slides-2",
      designTokens: { accent: "#2563eb" },
      slides: [{ id: "slide-1", sourceTsx: "source" }],
    }),
  };
  mocks.assertAccess.mockResolvedValue(undefined);
  mocks.notifyClients.mockResolvedValue(undefined);
});

describe("apply-design-system", () => {
  it("requires both deck and design-system IDs in its action schema", () => {
    expect(
      action.schema.safeParse({
        deckId: "deck-1",
        designSystemId: "design-system-1",
      }).success,
    ).toBe(true);
    expect(action.schema.safeParse({ deckId: "deck-1" }).success).toBe(false);
    expect(
      action.schema.safeParse({ designSystemId: "design-system-1" }).success,
    ).toBe(false);
  });

  it("persists the linked system in the deck relation with a revision compare-and-swap", async () => {
    const originalData = state.row!.data;
    const result = await action.run({
      deckId: "deck-1",
      designSystemId: "design-system-1",
    });

    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      1,
      "deck",
      "deck-1",
      "editor",
    );
    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      2,
      "design-system",
      "design-system-1",
      "viewer",
    );
    expect(state.updateSet).toMatchObject({
      designSystemId: "design-system-1",
    });
    expect(state.updateWhere).toMatchObject({
      and: [
        { eq: ["decks.data", originalData] },
        {
          and: [
            { eq: ["decks.id", "deck-1"] },
            { eq: ["decks.updatedAt", initialUpdatedAt] },
          ],
        },
      ],
    });
    expect(JSON.parse(state.row!.data)).toEqual(JSON.parse(originalData));
    expect(Date.parse(state.updateSet!.updatedAt!)).toBeGreaterThan(
      Date.parse(initialUpdatedAt),
    );
    expect(result).toMatchObject({
      deckId: "deck-1",
      designSystemId: "design-system-1",
      applied: true,
      nextRequiredAction: "get-design-system",
    });
    expect(mocks.notifyClients).toHaveBeenCalledExactlyOnceWith("deck-1");
  });

  it("returns a typed write conflict when the deck revision changed", async () => {
    state.rowsAffected = 0;

    await expect(
      action.run({ deckId: "deck-1", designSystemId: "design-system-1" }),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 409,
      errorCode: "deck_write_conflict",
    });

    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("stops before querying the deck when access is denied", async () => {
    const accessError = new Error("forbidden");
    mocks.assertAccess.mockRejectedValueOnce(accessError);

    await expect(
      action.run({ deckId: "deck-1", designSystemId: "design-system-1" }),
    ).rejects.toBe(accessError);

    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("does not link a design system to a foreign app deck", async () => {
    state.row!.data = JSON.stringify({ appId: "slides", slides: [] });

    await expect(
      action.run({ deckId: "deck-1", designSystemId: "design-system-1" }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "deck_not_found" });

    expect(db.update).not.toHaveBeenCalled();
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });
});
