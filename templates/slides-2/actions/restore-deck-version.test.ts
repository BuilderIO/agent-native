import { beforeEach, describe, expect, it, vi } from "vitest";

const { ForbiddenError } = vi.hoisted(() => ({
  ForbiddenError: class ForbiddenError extends Error {},
}));
const mockAssertAccess = vi.fn();
const mockCreateDeckVersionSnapshot = vi.fn();
const mockNotifyClients = vi.fn();
const mockWriteAppState = vi.fn();

const currentSeed = {
  id: "deck-1",
  title: "Deck",
  designSystemId: "system-1",
  updatedAt: "2026-09-03T00:00:01.000Z",
  ownerEmail: "owner@example.com",
  data: JSON.stringify({
    appId: "slides-2",
    id: "deck-1",
    title: "Deck",
    designSystemId: "system-1",
    slides: [{ id: "slide-1", content: "current" }],
    updatedAt: "2026-09-03T00:00:01.000Z",
  }),
};
const current = { ...currentSeed };

const versionSeed = {
  id: "version-1",
  deckId: "deck-1",
  ownerEmail: "owner@example.com",
  title: "Deck",
  data: JSON.stringify({
    appId: "slides-2",
    id: "deck-1",
    title: "Deck",
    designSystemId: "system-1",
    slides: [{ id: "slide-1", content: "current" }],
    updatedAt: "2026-09-02T00:00:01.000Z",
  }),
};
const version = { ...versionSeed };

let versionRows: Array<typeof version> = [version];
let readbackRows: Array<typeof current> | null = null;
let rowsAffected = 1;
let pendingUpdate: Record<string, unknown> | null = null;
const versionWhereConditions: unknown[] = [];
const updateWhereConditions: unknown[] = [];
const readbackWhereConditions: unknown[] = [];

const versionLimit = vi.fn(async () => versionRows);
const versionWhere = vi.fn((condition: unknown) => {
  versionWhereConditions.push(condition);
  return { limit: versionLimit };
});
const versionFrom = vi.fn(() => ({ where: versionWhere }));
const selectFn = vi.fn(() => ({ from: versionFrom }));

const updateWhere = vi.fn(async (condition: unknown) => {
  updateWhereConditions.push(condition);
  if (rowsAffected === 1 && pendingUpdate) {
    Object.assign(current, pendingUpdate);
  }
  return { rowsAffected };
});
const updateSet = vi.fn((values: Record<string, unknown>) => {
  pendingUpdate = values;
  return { where: updateWhere };
});
const txUpdate = vi.fn(() => ({ set: updateSet }));
const readbackLimit = vi.fn(async () => readbackRows ?? [current]);
const readbackWhere = vi.fn((condition: unknown) => {
  readbackWhereConditions.push(condition);
  return { limit: readbackLimit };
});
const readbackFrom = vi.fn(() => ({ where: readbackWhere }));
const lockWhere = vi.fn(() => ({ for: vi.fn(async (_mode: string) => []) }));
const txSelect = vi.fn((selection: Record<string, unknown>) => ({
  from:
    Object.keys(selection).length === 1 && selection.id === "decks.id"
      ? vi.fn(() => ({ where: lockWhere }))
      : readbackFrom,
}));
const tx = { update: txUpdate, select: txSelect };
const mockDb = {
  select: selectFn,
  transaction: vi.fn(async (run: (transaction: typeof tx) => unknown) =>
    run(tx),
  ),
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

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), {
      name: "ActionContractError",
      actionContractError: true,
      ...options,
    });
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => {
    const result = mockAssertAccess(...args);
    return result === undefined
      ? Promise.resolve({ resource: current })
      : result;
  },
  ForbiddenError,
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

vi.mock("./_render-artifacts.js", () => ({
  assertDeckInlineImagesPersistable: vi.fn(),
}));

vi.mock("./patch-deck.js", () => ({
  isAgentPatchCaller: (caller: string | undefined) =>
    caller === "tool" ||
    caller === "mcp" ||
    caller === "a2a" ||
    caller === "webmcp",
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ isNull: column }),
}));

import action from "./restore-deck-version";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(current, currentSeed);
  Object.assign(version, versionSeed);
  versionRows = [version];
  readbackRows = null;
  rowsAffected = 1;
  pendingUpdate = null;
  versionWhereConditions.length = 0;
  updateWhereConditions.length = 0;
  readbackWhereConditions.length = 0;
});

describe("restore-deck-version action", () => {
  it("requires editor access and scopes the snapshot by deck and owner", async () => {
    await action.run({ deckId: "deck-1", versionId: "version-1" });

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(versionWhereConditions[0]).toEqual(
      expect.objectContaining({
        and: expect.arrayContaining([
          { column: "deck_versions.id", value: "version-1" },
          { column: "deck_versions.deck_id", value: "deck-1" },
          { column: "deck_versions.owner_email", value: "owner@example.com" },
        ]),
      }),
    );
  });

  it("skips a restore when the selected version already matches", async () => {
    const result = await action.run({
      deckId: "deck-1",
      versionId: "version-1",
    });

    expect(result).toEqual({
      id: "deck-1",
      title: "Deck",
      slideCount: 1,
      restoredVersionId: "version-1",
      updatedAt: current.updatedAt,
      url: "/deck/deck-1",
      applied: false,
    });
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockNotifyClients).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("returns a typed failure when an agent restore is already current", async () => {
    await expect(
      action.run(
        { deckId: "deck-1", versionId: "version-1" },
        { caller: "tool" },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "deck_version_already_current",
    });
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("reports missing snapshots with a typed not-found error", async () => {
    versionRows = [];

    await expect(
      action.run({ deckId: "deck-1", versionId: "missing" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_version_not_found",
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("hides the deck when editor access is denied", async () => {
    mockAssertAccess.mockRejectedValueOnce(new ForbiddenError("No access"));

    await expect(
      action.run({ deckId: "private-deck", versionId: "version-1" }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "deck_not_found" });
    expect(selectFn).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("does not mark a restore as safe to replay", () => {
    expect(action.retrySafe).toBe(false);
    expect(action.mcpAnnotations.idempotentHint).toBe(false);
  });

  it("returns the restored row only after transaction readback confirms it", async () => {
    version.data = JSON.stringify({
      appId: "slides-2",
      id: "deck-1",
      title: "Deck",
      designSystemId: "system-1",
      slides: [{ id: "slide-1", content: "restored" }],
      updatedAt: "2026-09-02T00:00:01.000Z",
    });

    const result = await action.run({
      deckId: "deck-1",
      versionId: "version-1",
    });

    expect(mockCreateDeckVersionSnapshot).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledOnce();
    expect(updateWhere).toHaveBeenCalledOnce();
    expect(updateWhereConditions[0]).toEqual(
      expect.objectContaining({
        and: expect.arrayContaining([
          { column: "decks.id", value: "deck-1" },
          { column: "decks.updated_at", value: currentSeed.updatedAt },
        ]),
      }),
    );
    expect(txSelect).toHaveBeenCalledTimes(2);
    expect(lockWhere).toHaveBeenCalledOnce();
    expect(readbackWhereConditions[0]).toEqual({
      column: "decks.id",
      value: "deck-1",
    });
    expect(result).toMatchObject({
      id: "deck-1",
      title: "Deck",
      slideCount: 1,
      restoredVersionId: "version-1",
      updatedAt: current.updatedAt,
      url: "/deck/deck-1",
      appUrl: "/deck/deck-1",
    });
    expect(JSON.parse(current.data).slides[0].content).toBe("restored");
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ source: "restore-deck-version" }),
    );
  });

  it("fails loudly if the persisted restore cannot be read back", async () => {
    version.data = JSON.stringify({
      appId: "slides-2",
      id: "deck-1",
      title: "Deck",
      designSystemId: "system-1",
      slides: [{ id: "slide-1", content: "restored" }],
    });
    readbackRows = [];

    await expect(
      action.run({ deckId: "deck-1", versionId: "version-1" }),
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "deck_restore_readback_failed",
    });
    expect(mockNotifyClients).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("rejects a stale revision instead of restoring over a newer edit", async () => {
    version.data = JSON.stringify({
      appId: "slides-2",
      id: "deck-1",
      title: "Deck",
      designSystemId: "system-1",
      slides: [{ id: "slide-1", content: "restored" }],
    });
    rowsAffected = 0;

    await expect(
      action.run({ deckId: "deck-1", versionId: "version-1" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "deck_write_conflict",
    });
    expect(current.updatedAt).toBe(currentSeed.updatedAt);
    expect(mockNotifyClients).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
});
