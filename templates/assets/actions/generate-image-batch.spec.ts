import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const requireGenerationSessionInLibraryMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());
const upsertVariantSlotMock = vi.hoisted(() => vi.fn());
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

vi.mock("./variant-slots.js", () => ({
  upsertVariantSlot: upsertVariantSlotMock,
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
    upsertVariantSlotMock.mockResolvedValue(undefined);
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
    expect(upsertVariantSlotMock).not.toHaveBeenCalled();
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
      undefined,
    );
    expect(db.updateSet).toHaveBeenCalledWith({
      activeAssetId: "asset-2",
      updatedAt: "2026-05-28T00:00:00.000Z",
    });
  });

  it("forwards non-dismissible picker slots to single-image generation", async () => {
    await action.run({
      libraryId: "lib-1",
      variantScopeId: "picker:tab-1",
      slots: [
        {
          slotId: "picker-candidate-1",
          prompt: "First",
          dismissible: false,
        },
      ],
    });

    expect(upsertVariantSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: expect.stringMatching(/^pending-.+-1$/),
        batchId: expect.any(String),
        libraryId: "lib-1",
        variantScopeId: "picker:tab-1",
        slotId: "picker-candidate-1",
        prompt: "First",
        status: "pending",
      }),
    );
    const pendingBatchId = upsertVariantSlotMock.mock.calls[0][0].batchId;
    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: "picker-candidate-1",
        variantBatchId: pendingBatchId,
        variantScopeId: "picker:tab-1",
        dismissible: false,
        activateSessionAsset: false,
      }),
      undefined,
    );
  });

  it("forwards exact embedded text controls per slot", async () => {
    await action.run({
      libraryId: "lib-1",
      slots: [
        {
          slotId: "slot-1",
          prompt: "Generate a cafe poster",
          embeddedText: "Bean & Brew",
          textPlacement: "centered headline",
        },
      ],
    });

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: "slot-1",
        embeddedText: "Bean & Brew",
        textPlacement: "centered headline",
      }),
      undefined,
    );
  });

  it("forwards the agent run context to each single-image generation", async () => {
    await action.run(
      {
        libraryId: "lib-1",
        slots: [{ slotId: "slot-1", prompt: "Generate a hero" }],
      },
      { caller: "tool", threadId: "thread-1" } as any,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: "slot-1" }),
      expect.objectContaining({ threadId: "thread-1" }),
    );
  });

  it("does not report dismissed slots as successful images", async () => {
    generateImageRunMock
      .mockResolvedValueOnce({
        runId: "run-1",
        dismissed: true,
        Artifacts: [],
      })
      .mockResolvedValueOnce({
        id: "asset-2",
        runId: "run-2",
        previewUrl: "/api/assets/asset-2/content",
      });

    const result = await action.run({
      libraryId: "lib-1",
      slots: [
        { slotId: "slot-1", prompt: "First" },
        { slotId: "slot-2", prompt: "Second" },
      ],
    });

    expect(result.images).toEqual([
      {
        slotId: "slot-1",
        ok: false,
        dismissed: true,
        runId: "run-1",
        error: "Candidate was dismissed before it completed.",
      },
      expect.objectContaining({
        slotId: "slot-2",
        ok: true,
        id: "asset-2",
        runId: "run-2",
      }),
    ]);
  });
});
