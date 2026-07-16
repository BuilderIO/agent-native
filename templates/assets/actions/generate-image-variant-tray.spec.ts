import { beforeEach, describe, expect, it, vi } from "vitest";

// Unlike generate-image-reference-board.spec.ts, this file keeps the REAL
// variant-slots.ts (and a fake application-state store) so the test exercises
// the actual read-modify-write merge logic, not just "was upsertVariantSlot
// called with X". This is the seam where the reported bug lives: a refine
// call must land in the SAME `asset-variants:<threadId>` app-state entry as
// the original batch, and must append rather than reset it.

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const generateProviderMock = vi.hoisted(() => vi.fn());
const createAssetFromBufferMock = vi.hoisted(() => vi.fn());
let nanoidCounter = 0;

const readAppStateMock = vi.hoisted(() => vi.fn());
const writeAppStateMock = vi.hoisted(() => vi.fn());
const deleteAppStateMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/action", () => ({}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: readAppStateMock,
  writeAppState: writeAppStateMock,
  deleteAppState: deleteAppStateMock,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "designer@example.com"),
  getRequestOrgId: vi.fn(() => "org-1"),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => `run-${++nanoidCounter}`),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetLibraries: { id: "libraries.id" },
    assetCollections: { id: "collections.id" },
    assetGenerationPresets: { id: "presets.id" },
    assetGenerationRuns: { id: "runs.id" },
    assetGenerationSessions: { id: "sessions.id" },
    assetGenerationSessionItems: {},
    assets: {
      id: "assets.id",
      libraryId: "assets.library_id",
      mimeType: "assets.mime_type",
      status: "assets.status",
    },
  },
}));

vi.mock("../server/lib/assets.js", () => ({
  createAssetFromBuffer: createAssetFromBufferMock,
}));

vi.mock("../server/lib/generation-presets.js", () => ({
  applyPromptTemplate: vi.fn((_template, prompt) => prompt),
}));

vi.mock("../server/lib/generation.js", () => ({
  DEFAULT_GENERATION_REFERENCE_LIMIT: 6,
  compilePrompt: vi.fn(() => "compiled prompt"),
  generateWithManagedImageProvider: generateProviderMock,
  isImageGenerationSetupError: vi.fn(() => false),
  loadReferenceData: vi.fn(async () => []),
  resolveImageModelForRequest: vi.fn(
    ({ presetModel, explicitModel }) =>
      explicitModel ?? presetModel ?? "gemini-3.1-flash-image",
  ),
  selectReferences: vi.fn(async () => []),
}));

vi.mock("../server/lib/image-processing.js", () => ({
  applyPresetSkeleton: vi.fn(async ({ subject }) => subject),
  compositeLogo: vi.fn(async ({ image }) => image),
  maskFromManualMaskAlpha: vi.fn(async () => Buffer.from("mask")),
  maskFromPlateAlpha: vi.fn(async () => Buffer.from("mask")),
  prepareGptImage2SkeletonInpaintImages: vi.fn(),
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-07-09T00:00:00.000Z"),
  parseJson: vi.fn((value: string | null | undefined, fallback: unknown) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
  stringifyJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("../server/lib/storage.js", () => ({
  getObject: vi.fn(),
}));

vi.mock("./_helpers.js", () => ({
  requireGenerationSessionInLibrary: vi.fn(),
  serializeAsset: vi.fn((asset) => ({
    ...asset,
    previewUrl: `/preview/${asset.id}`,
    thumbnailUrl: `/thumb/${asset.id}`,
  })),
}));

vi.mock("./_image-model-default.js", () => ({
  readImageModelDefault: vi.fn(async () => "gemini-3.1-flash-image"),
}));

vi.mock("./_tool-activity.js", () => ({
  withToolActivity: vi.fn(async (_context, _activity, fn) => fn()),
}));

import generateImage from "./generate-image.js";

function createWhereResult(rows: unknown[]) {
  return {
    limit: vi.fn(async () => rows),
  };
}

function createDb(selectRows: unknown[][]) {
  const inserted: unknown[] = [];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => createWhereResult(selectRows.shift() ?? [])),
    })),
  }));
  return {
    inserted,
    select,
    insert: vi.fn(() => ({
      values: vi.fn(async (row: unknown) => {
        inserted.push(row);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
  };
}

const library = {
  id: "lib-1",
  title: "Acme",
  customInstructions: "",
  styleBrief: "{}",
  settings: "{}",
  canonicalLogoAssetId: null,
};

let assetCounter = 0;

describe("generate-image variant tray integration", () => {
  let store: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    nanoidCounter = 0;
    assetCounter = 0;
    store = {};
    assertAccessMock.mockResolvedValue(undefined);
    generateProviderMock.mockResolvedValue({
      image: Buffer.from("image"),
      mimeType: "image/png",
      model: "gemini-3.1-flash-image",
      provider: "gemini",
    });
    createAssetFromBufferMock.mockImplementation(async () => {
      const id = `asset-${++assetCounter}`;
      return { id, libraryId: "lib-1", metadata: "{}" };
    });
    readAppStateMock.mockImplementation(async (key: string) =>
      store[key] ? JSON.parse(JSON.stringify(store[key])) : null,
    );
    writeAppStateMock.mockImplementation(
      async (key: string, value: Record<string, unknown>) => {
        store[key] = JSON.parse(JSON.stringify(value));
      },
    );
    deleteAppStateMock.mockImplementation(async (key: string) => {
      delete store[key];
      return true;
    });
    getDbMock.mockImplementation(() => createDb([[library], [library]]));
  });

  it("appends a refine result to the same thread tray instead of replacing the original batch", async () => {
    const threadId = "thread-1";

    // Simulate the initial batch of 3: same batchId, same thread scope.
    for (const slotId of ["slot-1", "slot-2", "slot-3"]) {
      getDbMock.mockReturnValueOnce(createDb([[library]]));
      await generateImage.run(
        {
          libraryId: "lib-1",
          prompt: "A Steve quote about Star Wars",
          slotId,
          variantBatchId: "batch-1",
        } as any,
        { threadId } as any,
      );
    }

    const afterBatch = store[`asset-variants:${threadId}`] as any;
    expect(afterBatch.slots.map((s: any) => s.slotId)).toEqual([
      "slot-1",
      "slot-2",
      "slot-3",
    ]);

    // Simulate refine-image delegating to generate-image with the source
    // asset's context: no batchId (new generation boundary), but
    // appendVariant: true and the SAME thread context forwarded.
    getDbMock.mockReturnValueOnce(createDb([[library]]));
    await generateImage.run(
      {
        libraryId: "lib-1",
        prompt:
          "A Steve quote about Star Wars\n\nUser feedback:\nadd illustrations",
        sourceAssetId: "asset-1",
        appendVariant: true,
      } as any,
      { threadId } as any,
    );

    const afterRefine = store[`asset-variants:${threadId}`] as any;
    expect(afterRefine.slots.map((s: any) => s.slotId)).toEqual([
      "slot-1",
      "slot-2",
      "slot-3",
      "run-4",
    ]);
    expect(afterRefine.slots[3]).toEqual(
      expect.objectContaining({ status: "ready", assetId: "asset-4" }),
    );
  });

  it("resets the tray for a fresh generation that does not set appendVariant", async () => {
    const threadId = "thread-1";

    for (const slotId of ["slot-1", "slot-2", "slot-3"]) {
      getDbMock.mockReturnValueOnce(createDb([[library]]));
      await generateImage.run(
        {
          libraryId: "lib-1",
          prompt: "First prompt",
          slotId,
          variantBatchId: "batch-1",
        } as any,
        { threadId } as any,
      );
    }

    getDbMock.mockReturnValueOnce(createDb([[library]]));
    await generateImage.run(
      {
        libraryId: "lib-1",
        prompt: "Totally new direction",
        variantBatchId: "batch-2",
      } as any,
      { threadId } as any,
    );

    const state = store[`asset-variants:${threadId}`] as any;
    expect(state.slots).toHaveLength(1);
    expect(state.batchId).toBe("batch-2");
  });

  it("still appends when a caller sets sourceAssetId directly without appendVariant", async () => {
    const threadId = "thread-1";

    for (const slotId of ["slot-1", "slot-2", "slot-3"]) {
      getDbMock.mockReturnValueOnce(createDb([[library]]));
      await generateImage.run(
        {
          libraryId: "lib-1",
          prompt: "First prompt",
          slotId,
          variantBatchId: "batch-1",
        } as any,
        { threadId } as any,
      );
    }

    // Simulates the agent calling generate-image directly (bypassing
    // refine-image) with sourceAssetId set but no explicit appendVariant.
    getDbMock.mockReturnValueOnce(createDb([[library]]));
    await generateImage.run(
      {
        libraryId: "lib-1",
        prompt: "Iterate on asset-1",
        sourceAssetId: "asset-1",
      } as any,
      { threadId } as any,
    );

    const state = store[`asset-variants:${threadId}`] as any;
    expect(state.slots.map((s: any) => s.slotId)).toEqual([
      "slot-1",
      "slot-2",
      "slot-3",
      "run-4",
    ]);
  });
});
