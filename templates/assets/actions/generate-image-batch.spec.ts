import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const requireGenerationSessionInLibraryMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());
const upsertVariantSlotMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const libraryAccessMock = vi.hoisted(() =>
  vi.fn(async () => ({ role: "owner", canApprove: true })),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
  resolveAccess: vi.fn(),
}));
const deleteDraftMock = vi.hoisted(() => vi.fn(async () => true));
const unrestrictedScope = vi.hoisted(() => ({
  unrestricted: true,
  approvableLibraryIds: new Set<string>(),
  ownRunIds: new Set<string>(),
  callerEmail: "viewer@example.test",
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
  runReadFilter: vi.fn(() => undefined),
  sessionReadFilter: vi.fn(() => undefined),
  canReadSession: vi.fn(() => true),
  deleteDraftAssetIfUnchanged: deleteDraftMock,
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
  absoluteUrl: vi.fn((path: string) => path),
  nowIso: vi.fn(() => "2026-05-28T00:00:00.000Z"),
}));

vi.mock("./_helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_helpers.js")>()),
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

import { detectArtifactReceipts } from "../../../packages/core/src/artifacts/detect.js";
import { imageArtifactLinks, serializeAssetSummary } from "./_helpers.js";
import action from "./generate-image-batch.js";

function createDb() {
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  return { update, updateSet, updateWhere };
}

function generatedImageResult(
  index: number,
  reuseLabels: Record<string, unknown>[] = [],
) {
  const row = {
    id: `asset-${index}`,
    generationRunId: `run-${index}`,
    title: `Generated image ${index}`,
    libraryId: "lib-1",
    collectionId: "collection-1",
    status: "candidate",
    mediaType: "image",
    aspectRatio: "16:9",
    width: 1536,
    height: 1024,
    mimeType: "image/png",
    objectKey: `https://cdn.example.com/generated/image-${index}.png`,
    thumbnailObjectKey: null,
  };
  const summary = serializeAssetSummary(row);
  return {
    ...summary,
    Artifacts: imageArtifactLinks({
      id: row.id,
      runId: row.generationRunId,
      previewUrl: summary.previewUrl,
      downloadUrl: summary.downloadUrl,
    }),
    contextMode: reuseLabels.length ? "auto" : "off",
    contextPackId: reuseLabels.length ? "context-pack-1" : null,
    reuseLabels,
  };
}

describe("generate-image-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryAccessMock.mockResolvedValue({ role: "owner", canApprove: true });
    assertAccessMock.mockResolvedValue(undefined);
    requireGenerationSessionInLibraryMock.mockResolvedValue({
      id: "session-1",
    });
    generateImageRunMock.mockResolvedValue({ assetId: "asset-1" });
    upsertVariantSlotMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue(createDb());
  });

  it("advertises only the compact agent-facing generation contract", () => {
    const fullShape = (action.schema as any).shape;
    const agentShape = (action.agentInputSchema as any).shape;

    expect(fullShape.libraryId.isOptional()).toBe(false);
    expect(agentShape.libraryId.isOptional()).toBe(false);
    expect(agentShape).not.toHaveProperty("variantScopeId");
    expect(agentShape).not.toHaveProperty("creativeContextRequestId");
    expect(agentShape).not.toHaveProperty("callerAppId");
  });

  it("only requires draft access, so a kit viewer can generate candidates", async () => {
    await action.run({
      libraryId: "lib-1",
      slots: [{ slotId: "slot-1", prompt: "Generate a hero" }],
    });

    // One argument means `assertCanDraft`; approving paths pass a second.
    expect(libraryAccessMock).toHaveBeenCalledWith("lib-1");
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

  it("forwards preset reference fills to every slot", async () => {
    await action.run({
      libraryId: "lib-1",
      presetId: "preset-1",
      presetReferenceFills: [{ referenceId: "guest", assetIds: ["guest-1"] }],
      slots: [
        { slotId: "slot-1", prompt: "First" },
        { slotId: "slot-2", prompt: "Second" },
      ],
    });

    expect(generateImageRunMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        slotId: "slot-1",
        presetReferenceFills: [{ referenceId: "guest", assetIds: ["guest-1"] }],
      }),
      undefined,
    );
    expect(generateImageRunMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        slotId: "slot-2",
        presetReferenceFills: [{ referenceId: "guest", assetIds: ["guest-1"] }],
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

  it("keeps a six-slot result within the recovered-run ledger budget", async () => {
    const reuseLabels = Array.from({ length: 8 }, (_, index) => ({
      itemId: `context-item-${index + 1}`,
      itemVersionId: `context-version-${index + 1}`,
      kind: "image-reference",
      label: `Approved campaign reference ${index + 1}`,
      dataRole: "untrusted-reference",
      influence: "reference-conditioned",
    }));
    generateImageRunMock.mockImplementation(async ({ slotId }) =>
      generatedImageResult(
        Number(String(slotId).split("-").at(-1)),
        reuseLabels,
      ),
    );

    const result = await action.run({
      libraryId: "lib-1",
      slots: Array.from({ length: 6 }, (_, index) => ({
        slotId: `slot-${index + 1}`,
        prompt: `Generate image ${index + 1}`,
      })),
    });

    expect(JSON.stringify(result, null, 2).length).toBeLessThan(8_000);
    expect(result).toMatchObject({
      contextMode: "auto",
      contextPackId: "context-pack-1",
      reuseLabels,
    });
    for (const image of result.images) {
      expect(image).not.toHaveProperty("contextMode");
      expect(image).not.toHaveProperty("contextPackId");
      expect(image).not.toHaveProperty("reuseLabels");
    }
  });

  it("preserves picker fields and core image receipts", async () => {
    generateImageRunMock
      .mockResolvedValueOnce(generatedImageResult(1))
      .mockResolvedValueOnce({
        runId: "run-2",
        dismissed: true,
      });

    const result = await action.run({
      libraryId: "lib-1",
      slots: [
        { slotId: "slot-1", prompt: "First" },
        { slotId: "slot-2", prompt: "Second" },
      ],
    });

    expect(result.images).toEqual([
      expect.objectContaining({
        slotId: "slot-1",
        ok: true,
        runId: "run-1",
      }),
      {
        slotId: "slot-2",
        ok: false,
        dismissed: true,
        runId: "run-2",
        error: "Candidate was dismissed before it completed.",
      },
    ]);
    expect(detectArtifactReceipts(result, "generate-image-batch")).toEqual([
      expect.objectContaining({
        kind: "image",
        id: "asset-1",
        url: "/asset/asset-1",
        runId: "run-1",
      }),
    ]);
  });
});
