import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const insertChain = { values: vi.fn() };
  return {
    data: {} as Record<string, unknown>,
    existingFiles: [] as Array<{
      id: string;
      filename: string;
      content: string;
    }>,
    insertChain,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => state.existingFiles),
        })),
      })),
      insert: vi.fn(() => insertChain),
      update: vi.fn(),
    },
    mutateDesignData: vi.fn(),
    seedFromText: vi.fn(),
    hasCollabState: vi.fn(),
    applyText: vi.fn(),
    nanoid: vi.fn(),
  };
});

vi.mock("@agent-native/core/collab", () => ({
  seedFromText: state.seedFromText,
  hasCollabState: state.hasCollabState,
  applyText: state.applyText,
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
  sql: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: state.nanoid }));

vi.mock("../db/index.js", () => ({
  getDb: () => state.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
    },
  },
}));

vi.mock("./design-data-mutation.js", () => ({
  mutateDesignData: state.mutateDesignData,
}));

import { upsertFusionScreens } from "./fusion-screens.js";

beforeEach(() => {
  vi.clearAllMocks();
  state.existingFiles = [];
  state.data = {
    concurrentTokenWrite: { keep: true },
    canvasFrames: {
      existing: { x: 0, y: 0, width: 400, height: 300, z: 0 },
    },
    screenMetadata: {},
  };
  state.nanoid
    .mockReturnValueOnce("fusion-home")
    .mockReturnValueOnce("fusion-settings");
  state.insertChain.values.mockResolvedValue(undefined);
  state.seedFromText.mockResolvedValue(undefined);
  state.mutateDesignData.mockImplementation(
    async (options: {
      mutate: (
        current: Record<string, unknown>,
        context: { updatedAt: string },
      ) => Record<string, unknown>;
      isApplied: (current: Record<string, unknown>) => boolean;
    }) => {
      const updatedAt = "2026-07-09T12:00:00.000Z";
      state.data = options.mutate(state.data, { updatedAt });
      expect(options.isApplied(state.data)).toBe(true);
      return { data: state.data, updatedAt };
    },
  );
});

describe("fusion screen designs.data mutation", () => {
  it("places URL screens against the latest board without dropping sibling keys", async () => {
    const result = await upsertFusionScreens({
      designId: "design-1",
      previewUrl: "https://example.test",
      paths: ["/", "/settings"],
      width: 800,
      height: 600,
      gap: 100,
    });

    expect(result.screens).toHaveLength(2);
    expect(result.placedFrames).toHaveLength(2);
    expect(state.data.concurrentTokenWrite).toEqual({ keep: true });
    expect(state.data.canvasFrames).toMatchObject({
      existing: { x: 0, width: 400 },
      "fusion-home": { x: 500, width: 800, height: 600 },
      "fusion-settings": { x: 1400, width: 800, height: 600 },
    });
    expect(state.data.screenMetadata).toMatchObject({
      "fusion-home": {
        sourceType: "fusion",
        path: "/",
        url: "https://example.test/",
      },
      "fusion-settings": {
        sourceType: "fusion",
        path: "/settings",
        url: "https://example.test/settings",
      },
    });
  });
});
