import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  updateRows: [] as Array<{ status: string; trashedAt: string | null }>,
  existingRows: [{ id: "rec-1" }] as Array<Record<string, unknown>>,
  afterRows: [] as Array<{ status: string; trashedAt: string | null }>,
  selectCalls: 0,
  updateWhere: undefined as unknown,
}));

vi.mock("@agent-native/core/action", async (original) => ({
  ...(await original<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({
    role: "editor",
    resource: { expiresAt: null },
  })),
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  ne: (...args: unknown[]) => args,
  isNull: (...args: unknown[]) => ["isNull", ...args],
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          state.updateWhere = condition;
          return { returning: async () => state.updateRows };
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => {
          state.selectCalls += 1;
          return state.selectCalls === 1 ? state.existingRows : state.afterRows;
        },
      }),
    }),
  }),
  schema: {
    recordings: {
      id: "recordings.id",
      status: "recordings.status",
      trashedAt: "recordings.trashedAt",
      updatedAt: "recordings.updatedAt",
    },
  },
}));

import trashRecording from "./trash-recording.js";

describe("trash-recording", () => {
  beforeEach(() => {
    state.updateRows = [];
    state.existingRows = [{ id: "rec-1" }];
    state.afterRows = [];
    state.selectCalls = 0;
    state.updateWhere = undefined;
  });

  it("reports a recording another call trashed first as unchanged", async () => {
    // The guarded write matches nothing; the reread finds the other trash.
    state.existingRows = [{ status: "uploading", trashedAt: null }];
    state.afterRows = [
      { status: "uploading", trashedAt: "2026-10-21T12:00:00.000Z" },
    ];
    const action = trashRecording as unknown as {
      run: (args: { ids: string[] }) => Promise<unknown>;
    };

    await expect(action.run({ ids: ["rec-1"] })).resolves.toMatchObject({
      changed: 0,
      unchanged: 1,
    });
    expect(state.updateWhere).toContainEqual([
      "isNull",
      "recordings.trashedAt",
    ]);
  });

  it("reports the guarded update winning even if finalization changes status after it", async () => {
    state.updateRows = [
      { status: "uploading", trashedAt: "2026-10-21T12:00:00.000Z" },
    ];
    state.afterRows = [
      { status: "ready", trashedAt: "2026-10-21T12:00:00.000Z" },
    ];
    const action = trashRecording as unknown as {
      run: (args: { id: string; skipIfReady?: boolean }) => Promise<unknown>;
    };

    await expect(
      action.run({ id: "rec-1", skipIfReady: true }),
    ).resolves.toEqual({
      id: "rec-1",
      trashedAt: "2026-10-21T12:00:00.000Z",
      skipped: false,
    });
    expect(state.selectCalls).toBe(1);
  });

  it("reports a skip when a ready row fails the guarded update", async () => {
    state.afterRows = [{ status: "ready", trashedAt: null }];
    const action = trashRecording as unknown as {
      run: (args: { id: string; skipIfReady?: boolean }) => Promise<unknown>;
    };

    await expect(
      action.run({ id: "rec-1", skipIfReady: true }),
    ).resolves.toEqual({ id: "rec-1", trashedAt: null, skipped: true });
    expect(state.selectCalls).toBe(2);
  });

  it("still reports a skip for a ready recording that is already in trash", async () => {
    // abandon-recording-start releases hosted storage only when not skipped.
    state.existingRows = [
      { status: "ready", trashedAt: "2026-10-20T12:00:00.000Z" },
    ];
    const action = trashRecording as unknown as {
      run: (args: { id: string; skipIfReady?: boolean }) => Promise<unknown>;
    };

    await expect(
      action.run({ id: "rec-1", skipIfReady: true }),
    ).resolves.toEqual({
      id: "rec-1",
      trashedAt: "2026-10-20T12:00:00.000Z",
      skipped: true,
    });
    expect(state.selectCalls).toBe(1);
  });

  it("reports a ready recording a batch leaves in the library as skipped", async () => {
    state.afterRows = [{ status: "ready", trashedAt: null }];
    const action = trashRecording as unknown as {
      run: (args: { ids: string[]; skipIfReady?: boolean }) => Promise<unknown>;
    };

    await expect(
      action.run({ ids: ["rec-1"], skipIfReady: true }),
    ).resolves.toEqual({
      results: [
        {
          id: "rec-1",
          status: "skipped",
          reason: "Its upload already finished, so it stays in the library.",
        },
      ],
      changed: 0,
      unchanged: 0,
      skipped: 1,
    });
  });
});
