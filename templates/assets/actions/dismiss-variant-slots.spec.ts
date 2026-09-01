import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppStateMock = vi.hoisted(() => vi.fn());
const writeAppStateMock = vi.hoisted(() => vi.fn());
const deleteAppStateMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const libraryAccessMock = vi.hoisted(() =>
  vi.fn(async () => ({ role: "owner", canApprove: true })),
);
const forbiddenErrorClass = vi.hoisted(
  () =>
    class ForbiddenError extends Error {
      statusCode = 403;
    },
);

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
  ForbiddenError: forbiddenErrorClass,
}));
vi.mock("../server/lib/library-access.js", () => ({
  assertCanDraft: libraryAccessMock,
  assertCanApprove: libraryAccessMock,
  assertCanDraftAuthoredBy: libraryAccessMock,
  assertCanDeleteAsset: libraryAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assets: {
      id: "image_assets.id",
      libraryId: "image_assets.library_id",
      role: "image_assets.role",
      status: "image_assets.status",
      generationRunId: "image_assets.generation_run_id",
    },
  },
}));

import action from "./dismiss-variant-slots.js";

type AssetRow = {
  id: string;
  libraryId: string;
  role: string;
  status: string;
  generationRunId: string | null;
};

/** An unsaved draft candidate in `lib-1`, the shape dismiss is allowed to delete. */
function draftAsset(id: string, overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id,
    libraryId: "lib-1",
    role: "generated",
    status: "candidate",
    generationRunId: "run-1",
    ...overrides,
  };
}

/**
 * A live table, not a call recorder: the action deletes conditionally and then
 * re-reads the row, so the mock has to model both or the race test proves
 * nothing. `onBeforeDelete` is the hook that simulates a concurrent save.
 */
function createDb(
  assets: AssetRow[] = [draftAsset("asset-1"), draftAsset("asset-2")],
  onBeforeDelete?: (byId: Map<string, AssetRow>) => void,
) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const columnKeys: Record<string, keyof AssetRow> = {
    "image_assets.id": "id",
    "image_assets.library_id": "libraryId",
    "image_assets.role": "role",
    "image_assets.status": "status",
    "image_assets.generation_run_id": "generationRunId",
  };
  const equals = (asset: AssetRow, condition: any): boolean => {
    const clauses = condition?.conditions ?? [condition];
    return clauses.every((clause: any) => {
      const key = columnKeys[clause?.column];
      return key ? asset[key] === clause.value : true;
    });
  };
  const idOf = (condition: any): string | undefined => {
    const clauses = condition?.conditions ?? [condition];
    return clauses.find((clause: any) => clause?.column === "image_assets.id")
      ?.value;
  };
  const deleteWhere = vi.fn(async (condition: any) => {
    onBeforeDelete?.(byId);
    const id = idOf(condition);
    const asset = id ? byId.get(id) : undefined;
    if (asset && equals(asset, condition)) byId.delete(asset.id);
  });
  const deleteMock = vi.fn(() => ({ where: deleteWhere }));
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition: any) => ({
        limit: async () => {
          const id = idOf(condition);
          const asset = id ? byId.get(id) : undefined;
          return asset ? [asset] : [];
        },
      })),
    })),
  }));
  return {
    select: selectMock,
    delete: deleteMock,
    deleteWhere,
    remainingIds: () => Array.from(byId.keys()),
  };
}

describe("dismiss-variant-slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryAccessMock.mockResolvedValue({ role: "owner", canApprove: true });
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

    // Discarding a draft is drafting-class work, not approving.
    expect(libraryAccessMock).toHaveBeenCalledWith("lib-1");
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(db.remainingIds()).toEqual([]);
    expect(deleteAppStateMock).toHaveBeenCalledWith("asset-variants");
    expect(deleteAppStateMock).toHaveBeenCalledWith("image-variants");
    expect(writeAppStateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      dismissed: 2,
      assetsDeleted: 2,
      assetsRetained: 0,
      cleared: true,
    });
  });

  it("retains assets the caller may not discard instead of deleting them", async () => {
    // Variant state is client-writable, so a slot can point at anything.
    const db = createDb([
      draftAsset("asset-saved", { status: "saved" }),
      draftAsset("asset-other-kit", { libraryId: "lib-2" }),
      draftAsset("asset-mine"),
    ]);
    getDbMock.mockReturnValue(db);
    readAppStateMock.mockResolvedValueOnce({
      runId: "run-1",
      libraryId: "lib-1",
      prompt: "Dogs in a park",
      slots: [
        { slotId: "slot-1", status: "ready", assetId: "asset-saved" },
        { slotId: "slot-2", status: "ready", assetId: "asset-other-kit" },
        { slotId: "slot-3", status: "ready", assetId: "asset-mine" },
      ],
      updatedAt: "2026-05-28T00:00:00.000Z",
    });

    const result = await action.run({ scope: "all" });

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.remainingIds()).toEqual(["asset-saved", "asset-other-kit"]);
    expect(result).toEqual({
      dismissed: 3,
      assetsDeleted: 1,
      assetsRetained: 2,
      cleared: true,
    });
  });

  it("retains a draft the delete rules refuse", async () => {
    const db = createDb([draftAsset("asset-theirs")]);
    getDbMock.mockReturnValue(db);
    libraryAccessMock.mockImplementation((async (...args: unknown[]) => {
      // One argument is `assertCanDraft`; the asset-shaped call is the delete
      // rule, and it refuses another drafter's candidate.
      if (typeof args[0] === "object") {
        throw new forbiddenErrorClass("Requires editor role");
      }
      return { role: "viewer", canApprove: false };
    }) as never);
    readAppStateMock.mockResolvedValueOnce({
      runId: "run-1",
      libraryId: "lib-1",
      prompt: "Dogs in a park",
      slots: [{ slotId: "slot-1", status: "ready", assetId: "asset-theirs" }],
      updatedAt: "2026-05-28T00:00:00.000Z",
    });

    const result = await action.run({ scope: "all" });

    expect(db.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      dismissed: 1,
      assetsDeleted: 0,
      assetsRetained: 1,
      cleared: true,
    });
  });

  it("surfaces a failure while checking a draft instead of retaining it", async () => {
    const db = createDb([draftAsset("asset-1")]);
    getDbMock.mockReturnValue(db);
    libraryAccessMock.mockImplementation((async (...args: unknown[]) => {
      if (typeof args[0] === "object") throw new Error("db unavailable");
      return { role: "viewer", canApprove: false };
    }) as never);
    readAppStateMock.mockResolvedValueOnce({
      runId: "run-1",
      libraryId: "lib-1",
      prompt: "Dogs in a park",
      slots: [{ slotId: "slot-1", status: "ready", assetId: "asset-1" }],
      updatedAt: "2026-05-28T00:00:00.000Z",
    });

    // An unreadable check is not a permission answer, so it must not come back
    // as a quietly retained asset.
    await expect(action.run({ scope: "all" })).rejects.toThrow(
      "db unavailable",
    );
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("leaves a candidate an editor saved mid-dismissal in the kit", async () => {
    // The authorizing SELECT saw a draft; by the time the delete runs an editor
    // has approved it. The save has to win.
    const db = createDb([draftAsset("asset-1")], (byId) => {
      const saved = byId.get("asset-1");
      if (saved) byId.set("asset-1", { ...saved, status: "saved" });
    });
    getDbMock.mockReturnValue(db);
    readAppStateMock.mockResolvedValueOnce({
      runId: "run-1",
      libraryId: "lib-1",
      prompt: "Dogs in a park",
      slots: [{ slotId: "slot-1", status: "ready", assetId: "asset-1" }],
      updatedAt: "2026-05-28T00:00:00.000Z",
    });

    const result = await action.run({ scope: "all" });

    expect(db.remainingIds()).toEqual(["asset-1"]);
    expect(result).toEqual({
      dismissed: 1,
      assetsDeleted: 0,
      assetsRetained: 1,
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
    expect(db.remainingIds()).toEqual(["asset-1"]);
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
      assetsRetained: 0,
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
      assetsRetained: 0,
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
      assetsRetained: 0,
      cleared: true,
    });
    expect(deleteAppStateMock).toHaveBeenCalledWith(
      "asset-variants:picker:tab-1",
    );
    expect(states["asset-variants:picker:tab-1"]).toBeUndefined();
    expect(states["asset-variants"]).toBeUndefined();
  });
});
