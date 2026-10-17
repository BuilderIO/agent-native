import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAssetFromBuffer: vi.fn(),
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  getDb: vi.fn(),
  getObject: vi.fn(),
  notifyGenerationRunFinished: vi.fn(),
  pollBuilderVideoGeneration: vi.fn(),
  pollGeminiVideoGeneration: vi.fn(),
  prepareVideoGenerationProvider: vi.fn(),
  startVideoGeneration: vi.fn(),
}));

vi.mock("../db/index.js", async () => ({
  getDb: () => mocks.getDb(),
  schema: await import("../db/schema.js"),
}));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...conditions: unknown[]) => ({ operator: "and", conditions }),
    eq: (column: { name?: string }, value: unknown) => ({
      operator: "eq",
      column,
      value,
    }),
    ne: (column: { name?: string }, value: unknown) => ({
      operator: "ne",
      column,
      value,
    }),
  };
});
vi.mock("./assets.js", () => ({
  createAssetFromBuffer: mocks.createAssetFromBuffer,
}));
vi.mock("./storage.js", () => ({
  getObject: mocks.getObject,
}));
vi.mock("./generation-run-notifications.js", () => ({
  notifyGenerationRunFinished: mocks.notifyGenerationRunFinished,
}));
vi.mock("./video-generation.js", async () => {
  const actual = await vi.importActual<typeof import("./video-generation.js")>(
    "./video-generation.js",
  );
  return {
    ...actual,
    prepareVideoGenerationProvider: mocks.prepareVideoGenerationProvider,
    pollBuilderVideoGeneration: mocks.pollBuilderVideoGeneration,
    pollGeminiVideoGeneration: mocks.pollGeminiVideoGeneration,
    startVideoGeneration: mocks.startVideoGeneration,
  };
});

import * as schema from "../db/schema.js";
import { RetryableVideoGenerationError } from "./video-generation.js";
import { completeVideoGenerationRun } from "./video-runs.js";

function matchesWhere(
  condition: unknown,
  row: Record<string, unknown>,
): boolean {
  if (!condition || typeof condition !== "object") return true;
  const expression = condition as {
    operator?: string;
    conditions?: unknown[];
    column?: { name?: string };
    value?: unknown;
  };
  if (expression.operator === "and") {
    return (expression.conditions ?? []).every((item) =>
      matchesWhere(item, row),
    );
  }
  const columnName = expression.column?.name;
  if (!columnName) return false;
  if (expression.operator === "eq") {
    return row[columnName] === expression.value;
  }
  if (expression.operator === "ne") {
    return row[columnName] !== expression.value;
  }
  return false;
}

describe("completeVideoGenerationRun", () => {
  const updates: Record<string, unknown>[] = [];
  const run = {
    id: "run-1",
    libraryId: "library-1",
    collectionId: null,
    presetId: null,
    sessionId: null,
    prompt: "A product reveal",
    compiledPrompt: "A product reveal",
    mediaType: "video",
    model: "veo-3.1-generate-preview",
    aspectRatio: "16:9",
    imageSize: "720p",
    durationSeconds: 4,
    resolution: "720p",
    groundingMode: "off",
    referenceAssetIds: "[]",
    status: "processing",
    error: null,
    metadata: JSON.stringify({ provider: "builder", generationId: "gen-1" }),
    createdAt: "2026-09-24T00:00:00.000Z",
    completedAt: null,
    source: "ui",
    callerAppId: null,
    ownerEmail: "owner@example.test",
    orgId: null,
  } satisfies typeof schema.assetGenerationRuns.$inferSelect;

  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    mocks.getDb.mockReturnValue(mocks.db);
    mocks.db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }));
    mocks.db.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({ returning: async () => [{ ...run, ...values }] }),
        };
      },
    }));
    mocks.pollBuilderVideoGeneration.mockReset();
    mocks.prepareVideoGenerationProvider.mockResolvedValue({
      provider: "builder",
      auth: {
        authorization: "Bearer builder-session",
        spaceId: "space-1",
        userId: null,
      },
    });
  });

  it("keeps transient poll failures processing under the run owner's identity", async () => {
    mocks.pollBuilderVideoGeneration
      .mockRejectedValueOnce(
        new RetryableVideoGenerationError("Builder poll unavailable (503)."),
      )
      .mockResolvedValueOnce({ status: "processing", operation: {} });

    const retry = await completeVideoGenerationRun(run);

    expect(retry).toMatchObject({
      status: "processing",
      run: { status: "processing", error: "Builder poll unavailable (503)." },
    });
    expect(mocks.notifyGenerationRunFinished).not.toHaveBeenCalled();
    expect(mocks.pollBuilderVideoGeneration).toHaveBeenNthCalledWith(
      1,
      "gen-1",
      {
        userEmail: "owner@example.test",
        orgId: null,
      },
    );

    const resumed = await completeVideoGenerationRun(retry.run);

    expect(resumed).toMatchObject({
      status: "processing",
      run: { status: "processing", error: null },
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "processing",
        error: "Builder poll unavailable (503).",
      }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "processing", error: null }),
    );
  });

  it("retries an unconfirmed start with the saved run ID and Personal scope", async () => {
    const startingRun = {
      ...run,
      metadata: JSON.stringify({
        provider: "builder",
        providerStatus: "starting",
        sourceAssetId: null,
        settingsUsed: {
          negativePrompt: null,
          enhancePrompt: true,
          generateAudio: true,
        },
      }),
    };
    mocks.startVideoGeneration.mockResolvedValue({
      provider: "builder",
      generationId: "gen-retried",
    });

    const result = await completeVideoGenerationRun(startingRun);

    expect(mocks.prepareVideoGenerationProvider).toHaveBeenCalledWith(
      { userEmail: run.ownerEmail, orgId: null },
      "builder",
    );
    expect(mocks.startVideoGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id }),
      expect.objectContaining({ provider: "builder" }),
    );
    expect(result).toMatchObject({
      status: "processing",
      run: {
        status: "processing",
        error: null,
        metadata: expect.stringContaining('"generationId":"gen-retried"'),
      },
    });
    expect(mocks.pollBuilderVideoGeneration).not.toHaveBeenCalled();
  });

  it("keeps a start retryable after another transient response", async () => {
    const startingRun = {
      ...run,
      metadata: JSON.stringify({
        provider: "builder",
        providerStatus: "starting",
        sourceAssetId: null,
        settingsUsed: {
          negativePrompt: null,
          enhancePrompt: true,
          generateAudio: true,
        },
      }),
    };
    mocks.startVideoGeneration.mockRejectedValue(
      new RetryableVideoGenerationError("Builder start unavailable (503)."),
    );

    const result = await completeVideoGenerationRun(startingRun);

    expect(result).toMatchObject({
      status: "processing",
      run: {
        status: "processing",
        error: "Builder start unavailable (503).",
      },
    });
    expect(mocks.notifyGenerationRunFinished).not.toHaveBeenCalled();
  });

  it("keeps a Builder start pinned when its saved credentials are unavailable", async () => {
    const startingRun = {
      ...run,
      metadata: JSON.stringify({
        provider: "builder",
        providerStatus: "starting",
        sourceAssetId: null,
        settingsUsed: {
          negativePrompt: null,
          enhancePrompt: true,
          generateAudio: true,
        },
      }),
    };
    mocks.prepareVideoGenerationProvider.mockRejectedValue(
      new RetryableVideoGenerationError(
        "Builder credentials are temporarily unavailable.",
        "builder",
      ),
    );

    const result = await completeVideoGenerationRun(startingRun);

    expect(result).toMatchObject({
      status: "processing",
      run: {
        status: "processing",
        error: "Builder credentials are temporarily unavailable.",
      },
    });
    expect(mocks.prepareVideoGenerationProvider).toHaveBeenCalledWith(
      { userEmail: run.ownerEmail, orgId: null },
      "builder",
    );
    expect(mocks.startVideoGeneration).not.toHaveBeenCalled();
  });

  it("does not retry a Gemini start with no saved operation ID", async () => {
    const startingGeminiRun = {
      ...run,
      metadata: JSON.stringify({
        provider: "gemini",
        providerStatus: "starting",
        sourceAssetId: null,
        settingsUsed: {
          negativePrompt: null,
          enhancePrompt: true,
          generateAudio: true,
        },
      }),
    };

    await expect(completeVideoGenerationRun(startingGeminiRun)).rejects.toThrow(
      "not retried to avoid a duplicate generation",
    );

    expect(mocks.prepareVideoGenerationProvider).not.toHaveBeenCalled();
    expect(mocks.startVideoGeneration).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining(
          "not retried to avoid a duplicate generation",
        ),
      }),
    );
  });

  it("leaves a recent start marker alone while its provider request can finish", async () => {
    const startingRun = {
      ...run,
      metadata: JSON.stringify({
        provider: "gemini",
        providerStatus: "starting",
        startAttemptedAt: new Date().toISOString(),
        sourceAssetId: null,
        settingsUsed: {
          negativePrompt: null,
          enhancePrompt: true,
          generateAudio: true,
        },
      }),
    };
    mocks.db.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === schema.assetGenerationRuns ? [startingRun] : [],
        }),
      }),
    }));

    const result = await completeVideoGenerationRun(startingRun);

    expect(result).toMatchObject({
      status: "processing",
      run: { status: "processing", metadata: startingRun.metadata },
    });
    expect(mocks.prepareVideoGenerationProvider).not.toHaveBeenCalled();
    expect(mocks.startVideoGeneration).not.toHaveBeenCalled();
  });

  it("persists a newly selected provider before retrying a start", async () => {
    const selectingRun = {
      ...run,
      metadata: JSON.stringify({
        providerStatus: "selecting",
        sourceAssetId: null,
        settingsUsed: {
          negativePrompt: null,
          enhancePrompt: true,
          generateAudio: true,
        },
      }),
    };
    mocks.prepareVideoGenerationProvider.mockResolvedValue({
      provider: "gemini",
      apiKey: "gemini-key",
    });
    mocks.startVideoGeneration.mockImplementationOnce(async () => {
      const providerWrite = updates.find((update) => {
        if (typeof update.metadata !== "string") return false;
        const metadata = JSON.parse(update.metadata) as Record<string, unknown>;
        return (
          metadata.provider === "gemini" &&
          metadata.providerStatus === "starting"
        );
      });
      expect(providerWrite).toBeDefined();
      return { provider: "gemini", operationName: "operations/gemini-1" };
    });

    const result = await completeVideoGenerationRun(selectingRun);

    expect(result).toMatchObject({
      status: "processing",
      run: {
        status: "processing",
        metadata: expect.stringContaining(
          '"operationName":"operations/gemini-1"',
        ),
      },
    });
    expect(mocks.prepareVideoGenerationProvider).toHaveBeenCalledWith(
      { userEmail: run.ownerEmail, orgId: null },
      undefined,
    );
  });

  it("only dispatches one concurrent retryable Gemini start", async () => {
    const retryableRun = {
      ...run,
      orgId: "owner-org",
      metadata: JSON.stringify({
        provider: "gemini",
        providerStatus: "retryable",
        sourceAssetId: null,
        settingsUsed: {
          negativePrompt: null,
          enhancePrompt: true,
          generateAudio: true,
        },
      }),
    };
    let currentRun: typeof retryableRun = { ...retryableRun };
    mocks.prepareVideoGenerationProvider.mockResolvedValue({
      provider: "gemini",
      apiKey: "gemini-key",
    });
    mocks.db.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === schema.assetGenerationRuns ? [currentRun] : [],
        }),
      }),
    }));
    mocks.db.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            if (!matchesWhere(condition, currentRun)) return [];
            updates.push(values);
            currentRun = { ...currentRun, ...values };
            return [currentRun];
          },
        }),
      }),
    }));

    let releaseProvider!: () => void;
    let signalProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerStarted = new Promise<void>((resolve) => {
      signalProvider = resolve;
    });
    mocks.startVideoGeneration.mockImplementationOnce(async () => {
      signalProvider();
      await providerGate;
      return { provider: "gemini", operationName: "operations/gemini-1" };
    });

    const firstRefresh = completeVideoGenerationRun(retryableRun);
    await providerStarted;
    const secondRefresh = await completeVideoGenerationRun(retryableRun);

    expect(mocks.prepareVideoGenerationProvider).toHaveBeenCalledWith(
      { userEmail: run.ownerEmail, orgId: "owner-org" },
      "gemini",
    );
    expect(secondRefresh).toMatchObject({
      status: "processing",
      run: {
        status: "processing",
        metadata: expect.stringContaining('"providerStatus":"starting"'),
      },
    });
    expect(mocks.startVideoGeneration).toHaveBeenCalledOnce();

    releaseProvider();
    await expect(firstRefresh).resolves.toMatchObject({
      status: "processing",
      run: {
        status: "processing",
        metadata: expect.stringContaining(
          '"operationName":"operations/gemini-1"',
        ),
      },
    });
    expect(mocks.startVideoGeneration).toHaveBeenCalledOnce();
  });

  it("keeps a completed provider video retryable when saving it fails", async () => {
    mocks.db.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === schema.assetGenerationRuns ? [run] : [],
        }),
      }),
    }));
    mocks.db.transaction.mockImplementation(
      async (callback: (tx: typeof mocks.db) => Promise<unknown>) =>
        callback(mocks.db),
    );
    mocks.pollBuilderVideoGeneration.mockResolvedValue({
      status: "completed",
      video: {
        buffer: Buffer.from("video"),
        mimeType: "video/mp4",
        provider: "builder",
      },
    });
    mocks.createAssetFromBuffer.mockRejectedValue(
      new Error("Object storage temporarily unavailable."),
    );

    const result = await completeVideoGenerationRun(run);

    expect(result).toMatchObject({
      status: "processing",
      run: {
        status: "processing",
        error: "Object storage temporarily unavailable.",
      },
    });
    expect(mocks.notifyGenerationRunFinished).not.toHaveBeenCalled();
  });

  it("marks terminal provider errors failed and notifies the run owner", async () => {
    mocks.pollBuilderVideoGeneration.mockRejectedValueOnce(
      new Error("Builder video generation poll failed (422)."),
    );

    await expect(completeVideoGenerationRun(run)).rejects.toThrow("(422)");

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        error: "Builder video generation poll failed (422).",
      }),
    );
    expect(mocks.notifyGenerationRunFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", ownerEmail: run.ownerEmail }),
      "failed",
    );
  });

  it("keeps a terminal run failed when a stale poll reports processing", async () => {
    const failedRun = { ...run, status: "failed" };
    mocks.db.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === schema.assetGenerationRuns ? [failedRun] : [],
        }),
      }),
    }));
    mocks.db.update.mockImplementationOnce(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({ returning: async () => [] }),
        };
      },
    }));
    mocks.pollBuilderVideoGeneration.mockResolvedValueOnce({
      status: "processing",
      operation: {},
    });

    await expect(completeVideoGenerationRun(run)).resolves.toMatchObject({
      status: "failed",
      run: { status: "failed" },
      completionClaimed: false,
    });
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "processing", error: null }),
    );
  });
});
