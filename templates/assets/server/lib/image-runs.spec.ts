import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const createAssetFromBufferMock = vi.hoisted(() => vi.fn());
const generateWithManagedImageProviderOnceMock = vi.hoisted(() => vi.fn());
const upsertVariantSlotMock = vi.hoisted(() => vi.fn());
const wasVariantSlotDismissedMock = vi.hoisted(() => vi.fn());

const schemaMock = vi.hoisted(() => ({
  assetGenerationRuns: {
    id: "runs.id",
  },
  assets: {
    id: "assets.id",
    generationRunId: "assets.generationRunId",
  },
  assetLibraries: {
    id: "libraries.id",
    canonicalLogoAssetId: "libraries.canonicalLogoAssetId",
  },
  assetGenerationSessionItems: {},
  assetGenerationSessions: {
    id: "sessions.id",
    activeAssetId: "sessions.activeAssetId",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));

vi.mock("./assets.js", () => ({
  createAssetFromBuffer: createAssetFromBufferMock,
}));

vi.mock("./generation.js", () => ({
  generateWithManagedImageProviderOnce:
    generateWithManagedImageProviderOnceMock,
}));

vi.mock("./image-processing.js", () => ({
  compositeLogo: vi.fn(),
}));

vi.mock("./json.js", () => ({
  absoluteUrl: vi.fn((path: string) => path),
  nowIso: vi.fn(() => "2026-05-28T12:00:00.000Z"),
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

vi.mock("./storage.js", () => ({
  getObject: vi.fn(async () => Buffer.from([1])),
}));

vi.mock("../../actions/variant-slots.js", () => ({
  upsertVariantSlot: upsertVariantSlotMock,
  wasVariantSlotDismissed: wasVariantSlotDismissedMock,
}));

import {
  finalizeImageRun,
  finalizeImageRunWithinBudget,
} from "./image-runs.js";

type AssetRow = Record<string, any>;
type RunRow = Record<string, any>;
type TestState = {
  assets: AssetRow[];
  updates: any[];
  sessions?: Array<Record<string, any>>;
  sessionItems?: Array<Record<string, any>>;
};

function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-1",
    libraryId: "library-1",
    collectionId: null,
    presetId: null,
    sessionId: null,
    prompt: "A hero image",
    compiledPrompt: "Compiled prompt",
    mediaType: "image",
    model: "gemini-3.1-flash-image",
    aspectRatio: "16:9",
    imageSize: "2K",
    durationSeconds: null,
    resolution: null,
    groundingMode: "auto",
    referenceAssetIds: "[]",
    status: "processing",
    error: null,
    metadata: JSON.stringify({
      slotId: "slot-1",
      variantBatchId: "batch-1",
      providerStatus: "processing",
      categories: ["hero"],
    }),
    createdAt: "2026-05-28T11:59:00.000Z",
    completedAt: null,
    source: "chat",
    callerAppId: null,
    ownerEmail: null,
    orgId: null,
    ...overrides,
  };
}

function createDb(state: TestState) {
  function rowsFor(table: unknown, condition: any) {
    if (table === schemaMock.assets) {
      if (condition?.op === "inArray") {
        return state.assets.filter((asset) =>
          condition.values.includes(asset.id),
        );
      }
      if (condition?.column === schemaMock.assets.generationRunId) {
        return state.assets.filter(
          (asset) => asset.generationRunId === condition.value,
        );
      }
      if (condition?.column === schemaMock.assets.id) {
        return state.assets.filter((asset) => asset.id === condition.value);
      }
      return state.assets;
    }
    if (table === schemaMock.assetLibraries) {
      return [{ id: "library-1", canonicalLogoAssetId: null }];
    }
    if (table === schemaMock.assetGenerationSessions) {
      const sessions = state.sessions ?? [];
      if (condition?.column === schemaMock.assetGenerationSessions.id) {
        return sessions.filter((session) => session.id === condition.value);
      }
      return sessions;
    }
    return [];
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn((condition: any) => {
          const rows = rowsFor(table, condition);
          const promise = Promise.resolve(rows) as Promise<AssetRow[]> & {
            limit: (count: number) => Promise<AssetRow[]>;
          };
          promise.limit = vi.fn(async (count: number) => rows.slice(0, count));
          return promise;
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          state.updates.push(values);
        }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (row: AssetRow) => {
        if (table === schemaMock.assetGenerationSessionItems) {
          state.sessionItems ??= [];
          state.sessionItems.push(row);
          return;
        }
        if (row.id && state.assets.some((asset) => asset.id === row.id)) {
          throw new Error("duplicate asset id");
        }
        state.assets.push(row);
      }),
    })),
    transaction: vi.fn(async (fn: (tx: typeof db) => unknown) => fn(db)),
  };
  return db;
}

describe("image run finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wasVariantSlotDismissedMock.mockResolvedValue(false);
    upsertVariantSlotMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("finalizes an immediately completed image run and syncs the variant slot", async () => {
    const state = { assets: [] as AssetRow[], updates: [] as any[] };
    const db = createDb(state);
    getDbMock.mockReturnValue(db);
    createAssetFromBufferMock.mockImplementation(async (input: any) => {
      const asset = {
        id: input.id,
        libraryId: input.libraryId,
        collectionId: input.collectionId,
        objectKey: "https://cdn.builder.io/api/v1/image/assets%2Foriginal.png",
        thumbnailObjectKey:
          "https://cdn.builder.io/api/v1/image/assets%2Fthumb.webp",
        generationRunId: input.generationRunId,
      };
      state.assets.push(asset);
      return asset;
    });
    generateWithManagedImageProviderOnceMock.mockResolvedValue({
      status: "completed",
      output: {
        image: Buffer.from([1, 2, 3]),
        mimeType: "image/png",
        model: "builder-image",
        provider: "builder",
        providerGenerationId: "generation-1",
      },
    });

    const result = await finalizeImageRun(runRow() as any);

    expect(result.status).toBe("completed");
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0].id).toBe("image_run-1");
    expect(state.updates).toContainEqual(
      expect.objectContaining({ status: "completed", error: null }),
    );
    expect(upsertVariantSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        slotId: "slot-1",
        status: "ready",
        assetId: "image_run-1",
        previewUrl: "https://cdn.builder.io/api/v1/image/assets%2Foriginal.png",
        thumbnailUrl: "https://cdn.builder.io/api/v1/image/assets%2Fthumb.webp",
      }),
    );
  });

  it("leaves the run processing when the provider is still working", async () => {
    const state = { assets: [] as AssetRow[], updates: [] as any[] };
    getDbMock.mockReturnValue(createDb(state));
    generateWithManagedImageProviderOnceMock.mockResolvedValue({
      status: "processing",
    });

    const result = await finalizeImageRun(runRow() as any);

    expect(result.status).toBe("processing");
    expect(state.assets).toHaveLength(0);
    expect(state.updates).toContainEqual(
      expect.objectContaining({ status: "processing" }),
    );
    expect(upsertVariantSlotMock).not.toHaveBeenCalled();
  });

  it("does not restart an active manual fallback attempt", async () => {
    const state = { assets: [] as AssetRow[], updates: [] as any[] };
    getDbMock.mockReturnValue(createDb(state));

    const result = await finalizeImageRun(
      runRow({
        metadata: JSON.stringify({
          manualFallbackStartedAt: new Date().toISOString(),
        }),
      }) as any,
    );

    expect(result.status).toBe("processing");
    expect(generateWithManagedImageProviderOnceMock).not.toHaveBeenCalled();
    expect(state.assets).toHaveLength(0);
  });

  it("records manual fallback start before provider fallback runs", async () => {
    const state = { assets: [] as AssetRow[], updates: [] as any[] };
    const db = createDb(state);
    getDbMock.mockReturnValue(db);
    createAssetFromBufferMock.mockImplementation(async (input: any) => {
      const asset = {
        id: input.id,
        libraryId: input.libraryId,
        collectionId: input.collectionId,
        generationRunId: input.generationRunId,
      };
      state.assets.push(asset);
      return asset;
    });
    generateWithManagedImageProviderOnceMock.mockImplementation(
      async (input: any) => {
        await input.onManualFallbackStart();
        return {
          status: "completed",
          output: {
            image: Buffer.from([1, 2, 3]),
            mimeType: "image/png",
            model: "gpt-image-2",
            provider: "openai",
          },
        };
      },
    );

    const result = await finalizeImageRun(runRow() as any);

    expect(result.status).toBe("completed");
    expect(state.updates).toContainEqual(
      expect.objectContaining({
        status: "processing",
        metadata: expect.stringContaining("manualFallbackStartedAt"),
      }),
    );
  });

  it("does not use the short provider retry budget as the image download timeout", async () => {
    const state = { assets: [] as AssetRow[], updates: [] as any[] };
    getDbMock.mockReturnValue(createDb(state));
    generateWithManagedImageProviderOnceMock.mockResolvedValue({
      status: "processing",
    });

    await finalizeImageRun(runRow() as any, {
      providerAttemptTimeoutMs: 123,
    });

    const providerInput =
      generateWithManagedImageProviderOnceMock.mock.calls[0][0];
    expect(providerInput.requestTimeoutMs).toBe(123);
    expect("downloadTimeoutMs" in providerInput).toBe(false);
  });

  it("dedupes concurrent completion by reusing one asset for a run", async () => {
    const state = { assets: [] as AssetRow[], updates: [] as any[] };
    const db = createDb(state);
    getDbMock.mockReturnValue(db);
    createAssetFromBufferMock.mockImplementation(async (input: any) => {
      const asset = {
        id: input.id,
        libraryId: input.libraryId,
        collectionId: input.collectionId,
        generationRunId: input.generationRunId,
      };
      if (state.assets.some((row) => row.id === asset.id)) {
        throw new Error("duplicate asset id");
      }
      state.assets.push(asset);
      return asset;
    });
    generateWithManagedImageProviderOnceMock.mockResolvedValue({
      status: "completed",
      output: {
        image: Buffer.from([1, 2, 3]),
        mimeType: "image/png",
        model: "builder-image",
        provider: "builder",
      },
    });

    const results = await Promise.all([
      finalizeImageRun(runRow() as any),
      finalizeImageRun(runRow() as any),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0].generationRunId).toBe("run-1");
  });

  it("promotes a background batch candidate when the session has no active asset", async () => {
    const state = {
      assets: [] as AssetRow[],
      updates: [] as any[],
      sessions: [{ id: "session-1", activeAssetId: null }],
      sessionItems: [] as Array<Record<string, any>>,
    };
    const db = createDb(state);
    getDbMock.mockReturnValue(db);
    createAssetFromBufferMock.mockImplementation(async (input: any) => {
      const asset = {
        id: input.id,
        libraryId: input.libraryId,
        collectionId: input.collectionId,
        generationRunId: input.generationRunId,
      };
      state.assets.push(asset);
      return asset;
    });
    generateWithManagedImageProviderOnceMock.mockResolvedValue({
      status: "completed",
      output: {
        image: Buffer.from([1, 2, 3]),
        mimeType: "image/png",
        model: "builder-image",
        provider: "builder",
      },
    });

    const result = await finalizeImageRun(
      runRow({
        sessionId: "session-1",
        metadata: JSON.stringify({
          slotId: "slot-1",
          variantBatchId: "batch-1",
          activateSessionAsset: false,
        }),
      }) as any,
    );

    expect(result.status).toBe("completed");
    expect(state.sessionItems).toContainEqual(
      expect.objectContaining({
        sessionId: "session-1",
        assetId: "image_run-1",
        role: "active",
      }),
    );
    expect(state.updates).toContainEqual({
      activeAssetId: "image_run-1",
      updatedAt: "2026-05-28T12:00:00.000Z",
    });
  });

  it("returns processing when the inline budget elapses", async () => {
    vi.useFakeTimers();
    const state = { assets: [] as AssetRow[], updates: [] as any[] };
    getDbMock.mockReturnValue(createDb(state));
    generateWithManagedImageProviderOnceMock.mockReturnValue(
      new Promise(() => {}),
    );

    const resultPromise = finalizeImageRunWithinBudget(runRow() as any, 10);
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ status: "processing" }),
    );
    expect(state.assets).toHaveLength(0);
  });
});
