import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const libraryAccessMock = vi.hoisted(() =>
  vi.fn(async () => ({ role: "owner", canApprove: true })),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
  resolveAccess: vi.fn(async () => ({ role: "owner" })),
}));
const unrestrictedScope = vi.hoisted(() => ({
  unrestricted: true,
  approvableLibraryIds: new Set<string>(),
  ownRunIds: new Set<string>(),
}));

vi.mock("../server/lib/library-access.js", () => ({
  assertCanDraft: libraryAccessMock,
  assertCanApprove: libraryAccessMock,
  assertCanDraftAuthoredBy: libraryAccessMock,
  assertCanDeleteAsset: libraryAccessMock,
  // The draft-input guards have their own tests; these specs exercise the
  // surrounding behavior with an approver's unrestricted scope.
  draftScopeForLibrary: vi.fn(async () => unrestrictedScope),
  resolveDraftReadScope: vi.fn(async () => unrestrictedScope),
  unrestrictedDraftReadScope: vi.fn(() => unrestrictedScope),
  assertCanUseAssets: vi.fn(),
  assertCanUseRuns: vi.fn(),
  canReadDraftAsset: vi.fn(() => true),
  canReadRun: vi.fn(() => true),
  draftReadFilter: vi.fn(() => undefined),
}));

vi.mock("@agent-native/creative-context/server", () => ({
  recordGenerationCreativeContext: vi.fn(async () => undefined),
  resolveGenerationCreativeContext: vi.fn(async () => ({
    contextMode: "off",
    contextPackId: null,
    reuseLabels: [],
    results: [],
  })),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "designer@example.com"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "generated-id"),
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-05-28T00:00:00.000Z"),
  stringifyJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("./_helpers.js", () => ({
  serializeGenerationSession: vi.fn((row: unknown) => row),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetCollections: {
      id: "collections.id",
      libraryId: "collections.library_id",
    },
    assetGenerationPresets: {
      id: "presets.id",
      libraryId: "presets.library_id",
    },
    assetTemplates: {
      id: "templates.id",
      libraryId: "templates.library_id",
    },
    assetTemplateShares: {},
    assetLibraryShares: {},
    assetGenerationSessions: {
      id: "sessions.id",
      presetId: "sessions.preset_id",
    },
    assetGenerationSessionItems: {},
    assets: {
      id: "assets.id",
      libraryId: "assets.library_id",
    },
    assetGenerationRuns: {
      id: "runs.id",
      libraryId: "runs.library_id",
      presetId: "runs.preset_id",
    },
  },
}));

import createSessionAction from "./create-generation-session.js";
import deletePresetAction from "./delete-generation-preset.js";

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
  const deleteWhere = vi.fn(async () => undefined);
  const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
  const insertValues = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => createWhereResult(selectRows.shift() ?? [])),
    })),
  }));
  return {
    delete: deleteFrom,
    deleteWhere,
    insert,
    insertValues,
    select,
  };
}

describe("generation preset/session constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryAccessMock.mockResolvedValue({ role: "owner", canApprove: true });
    assertAccessMock.mockResolvedValue(undefined);
  });

  it("rejects creating a session with a preset from another collection", async () => {
    const db = createDb([
      [{ id: "collection-a", libraryId: "lib-1" }],
      [{ id: "preset-1", libraryId: "lib-1", collectionId: "collection-b" }],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      createSessionAction.run({
        libraryId: "lib-1",
        title: "Social handoff",
        collectionId: "collection-a",
        presetId: "preset-1",
      }),
    ).rejects.toThrow(/different collection/);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("blocks deleting a preset referenced by a handoff session", async () => {
    const db = createDb([
      [{ id: "preset-1", libraryId: "lib-1" }],
      [{ id: "session-1" }],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(deletePresetAction.run({ id: "preset-1" })).rejects.toThrow(
      /template-in-use/,
    );

    expect(db.delete).not.toHaveBeenCalled();
  });

  it("blocks deleting a template referenced by a generation run", async () => {
    const db = createDb([
      [{ id: "template-1", libraryId: "lib-1" }],
      [],
      [{ id: "run-1" }],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(deletePresetAction.run({ id: "template-1" })).rejects.toThrow(
      /template-in-use/,
    );

    expect(db.delete).not.toHaveBeenCalled();
  });
});
