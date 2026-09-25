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
  startVideoGeneration: vi.fn(),
}));

vi.mock("../db/index.js", async () => ({
  getDb: () => mocks.getDb(),
  schema: await import("../db/schema.js"),
}));
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
    pollBuilderVideoGeneration: mocks.pollBuilderVideoGeneration,
    pollGeminiVideoGeneration: mocks.pollGeminiVideoGeneration,
    startVideoGeneration: mocks.startVideoGeneration,
  };
});

import * as schema from "../db/schema.js";
import { RetryableVideoGenerationError } from "./video-generation.js";
import { completeVideoGenerationRun } from "./video-runs.js";

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

    expect(mocks.startVideoGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        identity: { userEmail: run.ownerEmail, orgId: null },
      }),
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
