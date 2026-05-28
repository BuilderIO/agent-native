import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "item-id"),
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-05-28T00:00:00.000Z"),
  parseJson: vi.fn((value: string, fallback: unknown) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
  stringifyJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetGenerationSessions: {
      id: "sessions.id",
    },
    assetGenerationSessionItems: {
      sessionId: "session_items.session_id",
      assetId: "session_items.asset_id",
      generationRunId: "session_items.generation_run_id",
    },
    assets: {
      id: "assets.id",
      libraryId: "assets.library_id",
    },
    assetGenerationRuns: {
      id: "runs.id",
      libraryId: "runs.library_id",
    },
  },
}));

import action from "./update-generation-session.js";

const session = {
  id: "session-1",
  libraryId: "lib-1",
  collectionId: null,
  presetId: null,
  title: "Session",
  brief: null,
  status: "open",
  activeAssetId: null,
  feedbackSummary: "",
  metadata: "{}",
  createdBy: null,
  createdAt: "2026-05-28T00:00:00.000Z",
  updatedAt: "2026-05-28T00:00:00.000Z",
};

function createWhereResult(rows: unknown[]) {
  return {
    limit: vi.fn(async () => rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
}

function createDb(selectRows: unknown[][]) {
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const insertValues = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => createWhereResult(selectRows.shift() ?? [])),
    })),
  }));
  return {
    insert,
    insertValues,
    select,
    update,
    updateSet,
    updateWhere,
  };
}

describe("update-generation-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
  });

  it("rejects a missing activeAssetId before mutating the session", async () => {
    const db = createDb([[session], [], []]);
    getDbMock.mockReturnValue(db);

    await expect(
      action.run({ id: "session-1", activeAssetId: "asset-missing" }),
    ).rejects.toThrow(/Asset asset-missing was not found/);

    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects assetIds that are already linked to the session", async () => {
    const db = createDb([
      [session],
      [{ assetId: "asset-1", generationRunId: null }],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      action.run({ id: "session-1", assetIds: ["asset-1"] }),
    ).rejects.toThrow(/Asset asset-1 is already in this generation session/);

    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("allows selecting an existing session asset as active without reinserting it", async () => {
    const db = createDb([
      [session],
      [{ assetId: "asset-1", generationRunId: null }],
      [{ id: "asset-1", libraryId: "lib-1" }],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      action.run({ id: "session-1", activeAssetId: "asset-1" }),
    ).resolves.toMatchObject({ activeAssetId: "asset-1" });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
