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
      transaction: vi.fn(async (callback) =>
        callback({
          ...state.db,
          execute: vi.fn().mockResolvedValue({ rows: [] }),
        }),
      ),
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
  and: (...values: unknown[]) => values,
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

  it("renames an earlier fusion-prefixed screen instead of adding a new one", async () => {
    state.existingFiles = [
      {
        id: "legacy-home",
        filename: "fusion-home.html",
        content: "https://example.test/",
      },
    ];
    const rows = state.existingFiles;
    // One read lists the design's files, the other re-reads the row in the
    // update transaction.
    const selectWithLimit = () => ({
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Object.assign(Promise.resolve(rows), {
            limit: vi.fn(async () => [{ id: "legacy-home" }]),
          }),
        ),
      })),
    });
    state.db.select
      .mockImplementationOnce(selectWithLimit)
      .mockImplementationOnce(selectWithLimit);
    const set = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    state.db.update.mockImplementationOnce(() => ({ set }));
    state.hasCollabState.mockResolvedValue(false);

    const result = await upsertFusionScreens({
      designId: "design-1",
      previewUrl: "https://example.test",
      paths: ["/"],
      width: 800,
      height: 600,
      gap: 100,
    });

    expect(result.screens).toEqual([
      expect.objectContaining({
        fileId: "legacy-home",
        filename: "home.html",
        title: "Home",
      }),
    ]);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "home.html" }),
    );
    expect(state.insertChain.values).not.toHaveBeenCalled();
  });

  it("never adopts a user's own file that shares a screen's name", async () => {
    state.existingFiles = [
      {
        id: "user-home",
        filename: "home.html",
        content: "<!doctype html><h1>My page</h1>",
      },
    ];

    const result = await upsertFusionScreens({
      designId: "design-1",
      previewUrl: "https://example.test",
      paths: ["/"],
      width: 800,
      height: 600,
      gap: 100,
    });

    expect(result.screens).toEqual([
      expect.objectContaining({
        fileId: "fusion-home",
        filename: "home-2.html",
      }),
    ]);
    expect(state.db.update).not.toHaveBeenCalled();
    expect(state.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fusion-home", filename: "home-2.html" }),
    );
  });

  it("reuses the suffixed screen on a later sync instead of adding another", async () => {
    state.existingFiles = [
      {
        id: "user-home",
        filename: "home.html",
        content: "<!doctype html><h1>My page</h1>",
      },
      {
        id: "app-home",
        filename: "home-2.html",
        content: "https://example.test/",
      },
    ];
    const rows = state.existingFiles;
    const selectWithLimit = () => ({
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Object.assign(Promise.resolve(rows), {
            limit: vi.fn(async () => [{ id: "app-home" }]),
          }),
        ),
      })),
    });
    state.db.select
      .mockImplementationOnce(selectWithLimit)
      .mockImplementationOnce(selectWithLimit);
    const set = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    state.db.update.mockImplementationOnce(() => ({ set }));
    state.hasCollabState.mockResolvedValue(false);

    const result = await upsertFusionScreens({
      designId: "design-1",
      previewUrl: "https://example.test",
      paths: ["/"],
      width: 800,
      height: 600,
      gap: 100,
    });

    expect(result.screens).toEqual([
      expect.objectContaining({ fileId: "app-home", filename: "home-2.html" }),
    ]);
    expect(state.insertChain.values).not.toHaveBeenCalled();
  });
});
