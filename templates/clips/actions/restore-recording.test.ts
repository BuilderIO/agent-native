import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  /** Whether the restore's own write still finds the row as it read it. */
  writeMatches: true,
  /** The row a reread after a write that matched nothing finds. */
  afterRow: undefined as Record<string, unknown> | undefined,
  selects: 0,
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@agent-native/core/action", async (original) => ({
  ...(await original<typeof import("@agent-native/core/action")>()),
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({
    role: "editor",
    resource: { expiresAt: null },
  })),
}));
vi.mock("../server/db/index.js", () => ({
  schema: { recordings: {} },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => {
          mocks.selects += 1;
          const row =
            mocks.selects > 1 && mocks.afterRow ? mocks.afterRow : mocks.row;
          return row ? [row] : [];
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (!mocks.writeMatches) return [];
            mocks.updates.push(values);
            return [{ id: "shot-1" }];
          },
        }),
      }),
    }),
  }),
}));

import action from "./restore-recording";

const run = () => (action as any).run({ id: "shot-1" });

beforeEach(() => {
  mocks.row = {
    id: "shot-1",
    kind: "image",
    editsJson: "{}",
    archivedAt: null,
    trashedAt: "2026-09-25T00:00:00Z",
  };
  mocks.writeMatches = true;
  mocks.afterRow = undefined;
  mocks.selects = 0;
  mocks.updates = [];
});

describe("restore-recording", () => {
  it("restores a screenshot", async () => {
    await expect(run()).resolves.toEqual({ id: "shot-1" });
    expect(mocks.updates[0]).toMatchObject({ trashedAt: null });
  });

  it("refuses a screenshot a permanent delete has claimed", async () => {
    // It may already have lost its base; it can only be deleted again.
    mocks.row!.editsJson = JSON.stringify({
      permanentDeleteClaim: { at: "2026-09-26T00:00:00Z" },
    });
    await expect(run()).rejects.toThrow(/partly deleted/);
    expect(mocks.updates).toHaveLength(0);
  });

  it("reports a recording another call restored first as unchanged", async () => {
    mocks.row = {
      id: "shot-1",
      kind: "video",
      editsJson: "{}",
      archivedAt: null,
      trashedAt: "2026-09-25T00:00:00Z",
    };
    mocks.writeMatches = false;
    mocks.afterRow = { archivedAt: null, trashedAt: null };
    const batch = action as unknown as {
      run: (args: { ids: string[] }) => Promise<unknown>;
    };
    await expect(batch.run({ ids: ["shot-1"] })).resolves.toMatchObject({
      changed: 0,
      unchanged: 1,
    });
    expect(mocks.updates).toHaveLength(0);
  });

  it("loses to a delete that claims the screenshot mid-restore", async () => {
    mocks.writeMatches = false;
    await expect(run()).rejects.toThrow(/Nothing was restored/);
    expect(mocks.updates).toHaveLength(0);
  });
});
