import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SlideDesignTokens } from "../shared/slide-design-tokens.js";

const { db, mocks, state } = vi.hoisted(() => {
  const state = {
    row: null as null | {
      id: string;
      title: string;
      ownerEmail: string;
      data: string;
      updatedAt: string;
    },
    rowsAffected: 1,
    lastUpdateSet: undefined as
      | { data?: string; updatedAt?: string }
      | undefined,
    lastUpdateWhere: undefined as unknown,
    transactionEvents: [] as string[],
  };

  const db = {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
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
    set: (values: { data?: string; updatedAt?: string }) => {
      state.lastUpdateSet = values;
      return {
        where: async (condition: unknown) => {
          state.lastUpdateWhere = condition;
          state.transactionEvents.push("write");
          if (state.rowsAffected === 1 && state.row) {
            state.row = { ...state.row, ...values };
          }
          return { rowsAffected: state.rowsAffected };
        },
      };
    },
  }));
  db.transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => {
      state.transactionEvents.push("begin");
      try {
        const result = await callback(db);
        state.transactionEvents.push("commit");
        return result;
      } catch (error) {
        state.transactionEvents.push("rollback");
        throw error;
      }
    },
  );

  const mocks = {
    assertAccess: vi.fn(),
    createDeckVersionSnapshot: vi.fn(),
    deckVersionChatContextFromAction: vi.fn(),
    notifyClients: vi.fn(),
    resolveFonts: vi.fn(),
  };

  return { db, mocks, state };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/action", () => ({
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
  ForbiddenError: class ForbiddenError extends Error {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  isNull: (column: unknown) => ({ isNull: column }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      data: "decks.data",
      ownerEmail: "decks.ownerEmail",
      updatedAt: "decks.updatedAt",
    },
  },
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mocks.notifyClients(...args),
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: (...args: unknown[]) =>
    mocks.createDeckVersionSnapshot(...args),
  deckVersionChatContextFromAction: (...args: unknown[]) =>
    mocks.deckVersionChatContextFromAction(...args),
}));

vi.mock("../server/lib/uploaded-fonts.js", () => ({
  resolveSlideDesignFontAssets: (...args: unknown[]) =>
    mocks.resolveFonts(...args),
}));

vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_deckId: string, callback: () => Promise<unknown>) =>
    callback(),
}));

import action from "./update-deck-design-tokens.js";

const expectedUpdatedAt = "2026-01-01T00:00:00.000Z";
const originalTokens: SlideDesignTokens = {
  background: "#ffffff",
  text: "#111827",
  accent: "#2563eb",
  displayFont: "Arial",
  bodyFont: "Arial",
  heroScale: 1,
  bodyScale: 1,
  radius: 12,
};
const nextTokens: SlideDesignTokens = {
  ...originalTokens,
  background: "#fef3c7",
  accent: "#7c3aed",
  radius: 18,
};

function setDeckRow() {
  state.row = {
    id: "deck-1",
    title: "Deck",
    ownerEmail: "owner@example.com",
    updatedAt: expectedUpdatedAt,
    data: JSON.stringify({
      appId: "slides-2",
      title: "Deck",
      updatedAt: expectedUpdatedAt,
      designTokens: originalTokens,
      slides: [{ id: "slide-1", sourceTsx: "source" }],
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rowsAffected = 1;
  state.lastUpdateSet = undefined;
  state.lastUpdateWhere = undefined;
  state.transactionEvents.length = 0;
  setDeckRow();
  mocks.assertAccess.mockResolvedValue(undefined);
  mocks.createDeckVersionSnapshot.mockImplementation(async () => {
    state.transactionEvents.push("snapshot");
    return { created: true };
  });
  mocks.deckVersionChatContextFromAction.mockReturnValue(undefined);
  mocks.notifyClients.mockResolvedValue(undefined);
  mocks.resolveFonts.mockResolvedValue([]);
});

describe("update-deck-design-tokens", () => {
  it("snapshots and persists the new tokens with the expected deck revision", async () => {
    const originalData = state.row?.data;
    const result = await action.run({
      deckId: "deck-1",
      expectedUpdatedAt,
      tokens: nextTokens,
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.createDeckVersionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "deck-1", data: originalData }),
      expect.objectContaining({
        label: "Before changing deck design tokens",
        db,
      }),
    );
    expect(state.transactionEvents).toEqual([
      "begin",
      "snapshot",
      "write",
      "commit",
    ]);
    expect(state.lastUpdateWhere).toMatchObject({
      and: [
        { eq: ["decks.data", originalData] },
        {
          and: [
            { eq: ["decks.id", "deck-1"] },
            { eq: ["decks.updatedAt", expectedUpdatedAt] },
          ],
        },
      ],
    });

    const savedData = JSON.parse(String(state.lastUpdateSet?.data));
    expect(savedData.designTokens).toEqual(nextTokens);
    expect(savedData.slides).toEqual([{ id: "slide-1", sourceTsx: "source" }]);
    expect(Date.parse(savedData.updatedAt)).toBeGreaterThan(
      Date.parse(expectedUpdatedAt),
    );
    expect(result).toMatchObject({ deckId: "deck-1", tokens: nextTokens });
    expect(result.updatedAt).toBe(savedData.updatedAt);
    expect(mocks.notifyClients).toHaveBeenCalledWith("deck-1");
  });

  it("validates selected imported fonts against the deck owner before saving", async () => {
    const fontTokens: SlideDesignTokens = {
      ...nextTokens,
      displayFont: "Inter",
      displayFontAssetId: "font-1",
    };
    mocks.resolveFonts.mockResolvedValue([
      {
        assetId: "font-1",
        family: "Inter",
        variant: "400",
        mimeType: "font/woff2",
        url: "https://storage.example.test/fonts/inter.woff2",
      },
    ]);

    await action.run({
      deckId: "deck-1",
      expectedUpdatedAt,
      tokens: fontTokens,
    });

    expect(mocks.resolveFonts).toHaveBeenCalledWith(fontTokens, {
      deckId: "deck-1",
      ownerEmail: "owner@example.com",
      orgId: undefined,
    });
    expect(JSON.parse(String(state.lastUpdateSet?.data)).designTokens).toEqual(
      fontTokens,
    );
  });

  it("rejects a lost revision compare-and-swap without changing the deck", async () => {
    const originalData = state.row?.data;
    state.rowsAffected = 0;

    await expect(
      action.run({
        deckId: "deck-1",
        expectedUpdatedAt,
        tokens: nextTokens,
      }),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 409,
      errorCode: "deck_write_conflict",
    });

    expect(state.row?.data).toBe(originalData);
    expect(state.transactionEvents).toEqual([
      "begin",
      "snapshot",
      "write",
      "rollback",
    ]);
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("returns typed errors for missing decks and invalid stored data", async () => {
    state.row = null;

    await expect(
      action.run({ deckId: "deck-1", expectedUpdatedAt, tokens: nextTokens }),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 404,
      errorCode: "deck_not_found",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");

    setDeckRow();
    state.row!.data = "{";

    await expect(
      action.run({ deckId: "deck-1", expectedUpdatedAt, tokens: nextTokens }),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 500,
      errorCode: "invalid_deck_data",
    });

    setDeckRow();
    state.row!.data = JSON.stringify({
      appId: "slides-2",
      title: "Deck",
      designTokens: { accent: "invalid" },
      slides: [{ id: "slide-1", sourceTsx: "source" }],
    });

    await expect(
      action.run({ deckId: "deck-1", expectedUpdatedAt, tokens: nextTokens }),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 409,
      errorCode: "invalid_deck_design_tokens",
    });

    expect(mocks.createDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("stops before reading the deck when editor access is denied", async () => {
    const accessError = new Error("forbidden");
    mocks.assertAccess.mockRejectedValueOnce(accessError);

    await expect(
      action.run({ deckId: "deck-1", expectedUpdatedAt, tokens: nextTokens }),
    ).rejects.toBe(accessError);

    expect(db.select).not.toHaveBeenCalled();
    expect(mocks.createDeckVersionSnapshot).not.toHaveBeenCalled();
  });
});
