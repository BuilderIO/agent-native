import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const requireGenerationSessionInLibraryMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetGenerationSessions: {
      id: "sessions.id",
    },
  },
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-05-28T00:00:00.000Z"),
}));

vi.mock("./_helpers.js", () => ({
  requireGenerationSessionInLibrary: requireGenerationSessionInLibraryMock,
}));

vi.mock("./generate-image.js", () => ({
  default: {
    run: generateImageRunMock,
  },
}));

import action from "./generate-image-batch.js";

function createDb() {
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  return { update, updateSet, updateWhere };
}

describe("generate-image-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
    requireGenerationSessionInLibraryMock.mockResolvedValue({
      id: "session-1",
    });
    generateImageRunMock.mockResolvedValue({ assetId: "asset-1" });
    getDbMock.mockReturnValue(createDb());
  });

  it("validates sessionId before spawning slot generations", async () => {
    requireGenerationSessionInLibraryMock.mockRejectedValue(
      new Error("Generation session does not belong to this library."),
    );

    await expect(
      action.run({
        libraryId: "lib-1",
        sessionId: "session-other",
        slots: [{ slotId: "slot-1", prompt: "Generate a hero" }],
      }),
    ).rejects.toThrow(/does not belong to this library/);

    expect(generateImageRunMock).not.toHaveBeenCalled();
  });

  it("chooses the first successful batch output as the active session asset", async () => {
    const db = createDb();
    getDbMock.mockReturnValue(db);
    generateImageRunMock
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce({ id: "asset-2" })
      .mockResolvedValueOnce({ id: "asset-3" });

    const result = await action.run({
      libraryId: "lib-1",
      sessionId: "session-1",
      slots: [
        { slotId: "slot-1", prompt: "First" },
        { slotId: "slot-2", prompt: "Second" },
        { slotId: "slot-3", prompt: "Third" },
      ],
    });

    expect(result.images.map((image: any) => image.ok)).toEqual([
      false,
      true,
      true,
    ]);
    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: "slot-1",
        activateSessionAsset: false,
      }),
    );
    expect(db.updateSet).toHaveBeenCalledWith({
      activeAssetId: "asset-2",
      updatedAt: "2026-05-28T00:00:00.000Z",
    });
  });
});
