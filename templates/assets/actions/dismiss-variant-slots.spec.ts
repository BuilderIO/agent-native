import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppStateMock = vi.hoisted(() => vi.fn());
const writeAppStateMock = vi.hoisted(() => vi.fn());
const deleteAppStateMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: readAppStateMock,
  writeAppState: writeAppStateMock,
  deleteAppState: deleteAppStateMock,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assets: {
      id: "image_assets.id",
    },
  },
}));

import action from "./dismiss-variant-slots.js";

function createDb() {
  const deleteWhere = vi.fn(async () => undefined);
  const deleteMock = vi.fn(() => ({ where: deleteWhere }));
  return {
    delete: deleteMock,
    deleteWhere,
  };
}

describe("dismiss-variant-slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
    deleteAppStateMock.mockResolvedValue(true);
  });

  it("clears all live candidates and deletes their asset rows", async () => {
    const db = createDb();
    getDbMock.mockReturnValue(db);
    readAppStateMock.mockResolvedValueOnce({
      runId: "run-1",
      libraryId: "lib-1",
      prompt: "Dogs in a park",
      slots: [
        { slotId: "slot-1", status: "ready", assetId: "asset-1" },
        { slotId: "slot-2", status: "ready", assetId: "asset-2" },
      ],
      updatedAt: "2026-05-28T00:00:00.000Z",
    });

    const result = await action.run({ scope: "all" });

    expect(assertAccessMock).toHaveBeenCalledWith(
      "asset-library",
      "lib-1",
      "editor",
    );
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(db.deleteWhere).toHaveBeenNthCalledWith(1, {
      column: "image_assets.id",
      value: "asset-1",
    });
    expect(db.deleteWhere).toHaveBeenNthCalledWith(2, {
      column: "image_assets.id",
      value: "asset-2",
    });
    expect(deleteAppStateMock).toHaveBeenCalledWith("asset-variants");
    expect(deleteAppStateMock).toHaveBeenCalledWith("image-variants");
    expect(writeAppStateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      dismissed: 2,
      assetsDeleted: 2,
      cleared: true,
    });
  });

  it("dismisses failed slots while keeping ready candidates", async () => {
    const db = createDb();
    getDbMock.mockReturnValue(db);
    readAppStateMock.mockResolvedValueOnce({
      runId: "run-1",
      libraryId: "lib-1",
      prompt: "Dogs in a park",
      slots: [
        { slotId: "slot-1", status: "ready", assetId: "asset-1" },
        {
          slotId: "slot-2",
          status: "failed",
          assetId: "asset-2",
          error: "Timed out",
        },
      ],
      updatedAt: "2026-05-28T00:00:00.000Z",
    });

    const result = await action.run({ scope: "failed" });

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.deleteWhere).toHaveBeenCalledWith({
      column: "image_assets.id",
      value: "asset-2",
    });
    expect(writeAppStateMock).toHaveBeenCalledWith(
      "asset-variants",
      expect.objectContaining({
        slots: [{ slotId: "slot-1", status: "ready", assetId: "asset-1" }],
      }),
    );
    expect(deleteAppStateMock).toHaveBeenCalledWith("image-variants");
    expect(result).toEqual({
      dismissed: 1,
      assetsDeleted: 1,
      cleared: false,
    });
  });

  it("clears only the requested thread-scoped candidate state", async () => {
    const db = createDb();
    getDbMock.mockReturnValue(db);
    const states: Record<string, any> = {
      "asset-variants:thread-1": {
        runId: "run-1",
        libraryId: "lib-1",
        threadId: "thread-1",
        prompt: "Thread one",
        slots: [{ slotId: "slot-1", status: "ready", assetId: "asset-1" }],
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      "asset-variants:thread-2": {
        runId: "run-2",
        libraryId: "lib-1",
        threadId: "thread-2",
        prompt: "Thread two",
        slots: [{ slotId: "slot-2", status: "ready", assetId: "asset-2" }],
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    };
    states["asset-variants"] = states["asset-variants:thread-1"];
    readAppStateMock.mockImplementation(async (key: string) =>
      states[key] ? JSON.parse(JSON.stringify(states[key])) : null,
    );
    deleteAppStateMock.mockImplementation(async (key: string) => {
      delete states[key];
      return true;
    });

    const result = await action.run({ scope: "all", threadId: "thread-1" });

    expect(result).toEqual({
      dismissed: 1,
      assetsDeleted: 1,
      cleared: true,
    });
    expect(deleteAppStateMock).toHaveBeenCalledWith("asset-variants:thread-1");
    expect(states["asset-variants:thread-2"]).toBeTruthy();
  });

  it("clears picker-scoped candidate state when invoked through the global mirror", async () => {
    const db = createDb();
    getDbMock.mockReturnValue(db);
    const states: Record<string, any> = {
      "asset-variants:picker:tab-1": {
        runId: "run-1",
        libraryId: "lib-1",
        variantScopeId: "picker:tab-1",
        prompt: "Embedded picker",
        slots: [{ slotId: "slot-1", status: "ready", assetId: "asset-1" }],
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    };
    states["asset-variants"] = states["asset-variants:picker:tab-1"];
    readAppStateMock.mockImplementation(async (key: string) =>
      states[key] ? JSON.parse(JSON.stringify(states[key])) : null,
    );
    deleteAppStateMock.mockImplementation(async (key: string) => {
      delete states[key];
      return true;
    });

    const result = await action.run({ scope: "all" });

    expect(result).toEqual({
      dismissed: 1,
      assetsDeleted: 1,
      cleared: true,
    });
    expect(deleteAppStateMock).toHaveBeenCalledWith(
      "asset-variants:picker:tab-1",
    );
    expect(states["asset-variants:picker:tab-1"]).toBeUndefined();
    expect(states["asset-variants"]).toBeUndefined();
  });
});
