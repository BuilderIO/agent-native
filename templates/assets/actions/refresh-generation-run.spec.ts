import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const completeVideoGenerationRunMock = vi.hoisted(() => vi.fn());
const upsertVariantSlotMock = vi.hoisted(() => vi.fn());
const updateSetCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

const schemaMock = vi.hoisted(() => ({
  assetGenerationRuns: {
    id: "assetGenerationRuns.id",
    libraryId: "assetGenerationRuns.libraryId",
  },
  assets: {
    generationRunId: "assets.generationRunId",
  },
}));

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
  schema: schemaMock,
}));

vi.mock("../server/lib/video-runs.js", () => ({
  completeVideoGenerationRun: completeVideoGenerationRunMock,
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-05-28T12:00:00.000Z"),
  parseJson: vi.fn((value: string | null | undefined, fallback: unknown) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
}));

vi.mock("./variant-slots.js", () => ({
  upsertVariantSlot: upsertVariantSlotMock,
}));

vi.mock("./_helpers.js", () => ({
  serializeAsset: vi.fn((asset) => ({
    id: asset.id,
    previewUrl: `/api/assets/${asset.id}/content`,
    thumbnailUrl: `/api/assets/${asset.id}/content?variant=thumb`,
  })),
  serializeGenerationRun: vi.fn((run) => run),
}));

import action from "./refresh-generation-run.js";

function createDb({
  run,
  assets,
}: {
  run: Record<string, unknown>;
  assets: Array<Record<string, unknown>>;
}) {
  const rowsForTable = (table: unknown) =>
    table === schemaMock.assetGenerationRuns ? [run] : assets;
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          const rows = rowsForTable(table);
          const promise = Promise.resolve(rows) as Promise<
            Array<Record<string, unknown>>
          > & {
            limit: (count: number) => Promise<Array<Record<string, unknown>>>;
          };
          promise.limit = vi.fn(async (count: number) => rows.slice(0, count));
          return promise;
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updateSetCalls.push(values);
        }),
      })),
    })),
  };
}

describe("refresh-generation-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetCalls.length = 0;
    assertAccessMock.mockResolvedValue(undefined);
    upsertVariantSlotMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a stale pending image run failed and syncs the live slot", async () => {
    getDbMock.mockReturnValue(
      createDb({
        run: {
          id: "run-1",
          libraryId: "library-1",
          collectionId: null,
          presetId: null,
          sessionId: null,
          prompt: "Recreate this diagram",
          mediaType: "image",
          status: "pending",
          error: null,
          metadata: JSON.stringify({
            slotId: "agent-workflow-final",
            variantBatchId: "batch-1",
            threadId: "thread-1",
            variantScopeId: "thread-1",
          }),
          createdAt: "2026-05-28T11:57:00.000Z",
        },
        assets: [],
      }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));

    const result = await action.run({ runId: "run-1" });

    expect(result.run.status).toBe("failed");
    expect(updateSetCalls[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        completedAt: "2026-05-28T12:00:00.000Z",
      }),
    );
    expect(upsertVariantSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        batchId: "batch-1",
        libraryId: "library-1",
        threadId: "thread-1",
        variantScopeId: "thread-1",
        slotId: "agent-workflow-final",
        status: "failed",
      }),
    );
    expect(completeVideoGenerationRunMock).not.toHaveBeenCalled();
  });

  it("restores a completed image asset into its live slot", async () => {
    getDbMock.mockReturnValue(
      createDb({
        run: {
          id: "run-2",
          libraryId: "library-1",
          collectionId: null,
          presetId: null,
          sessionId: null,
          prompt: "Hero image",
          mediaType: "image",
          status: "pending",
          error: null,
          metadata: JSON.stringify({ slotId: "hero-slot" }),
          createdAt: "2026-05-28T11:59:30.000Z",
        },
        assets: [{ id: "asset-1" }],
      }),
    );

    const result = await action.run({ runId: "run-2" });

    expect(result.assets).toEqual([expect.objectContaining({ id: "asset-1" })]);
    expect(upsertVariantSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-2",
        slotId: "hero-slot",
        status: "ready",
        assetId: "asset-1",
        previewUrl: "/api/assets/asset-1/content",
      }),
    );
  });
});
