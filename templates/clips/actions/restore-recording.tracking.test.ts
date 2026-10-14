import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as null | {
    id: string;
    kind: string;
    editsJson: string;
    status: string;
    trashedAt: string | null;
    archivedAt: string | null;
    recordingPlatform: string | null;
  },
  track: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: async () => {},
}));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: async () => {} }));
vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => state.track(...args),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: () => ({ eq: true }),
  isNotNull: () => ({ trashed: true }),
}));
vi.mock("../server/db/index.js", () => {
  type Condition = { and?: Condition[]; trashed?: boolean };
  const requiresTrashed = (condition: Condition): boolean =>
    Boolean(condition.trashed) ||
    (condition.and ?? []).some((part) => requiresTrashed(part));
  return {
    schema: {
      recordings: {
        id: "id",
        status: "status",
        trashedAt: "trashed_at",
        editsJson: "edits_json",
        recordingPlatform: "recording_platform",
      },
    },
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: async () => (state.row ? [{ ...state.row }] : []),
        }),
      }),
      update: () => ({
        set: () => ({
          where: (condition: Condition) => ({
            returning: async () => {
              const row = state.row;
              if (!row) return [];
              if (requiresTrashed(condition) && row.trashedAt === null) {
                return [];
              }
              row.trashedAt = null;
              row.archivedAt = null;
              return [
                {
                  id: row.id,
                  status: row.status,
                  recordingPlatform: row.recordingPlatform,
                },
              ];
            },
          }),
        }),
      }),
    }),
  };
});

import restoreRecording from "./restore-recording";

const action = restoreRecording as unknown as {
  run: (args: { id: string }) => Promise<unknown>;
};
const restoredEvents = () =>
  state.track.mock.calls.filter(([name]) => name === "recording_restored");

function row(
  status: string,
  where: { trashedAt?: string | null; archivedAt?: string | null } = {
    trashedAt: "2026-10-14T00:00:00.000Z",
  },
) {
  state.row = {
    id: "rec-1",
    kind: "video",
    editsJson: "{}",
    status,
    trashedAt: where.trashedAt ?? null,
    archivedAt: where.archivedAt ?? null,
    recordingPlatform: "web",
  };
}

describe("restore-recording recording_restored", () => {
  beforeEach(() => {
    state.track.mockReset();
    state.row = null;
  });

  it("reopens a discarded row once when an in-flight recording leaves the trash", async () => {
    row("uploading");

    await action.run({ id: "rec-1" });

    expect(state.row?.trashedAt).toBeNull();
    expect(restoredEvents()).toEqual([
      [
        "recording_restored",
        {
          app_name: "clips",
          template_name: "clips",
          output_id: "rec-1",
          output_type: "clip",
          recording_platform: "web",
          status_at_restore: "uploading",
        },
        expect.objectContaining({ userId: "owner@example.com" }),
      ],
    ]);
  });

  it("does not fire for a ready or failed clip, or for an archived row that was never trashed", async () => {
    row("ready");
    await action.run({ id: "rec-1" });

    row("failed");
    await action.run({ id: "rec-1" });

    row("processing", { archivedAt: "2026-10-14T00:00:00.000Z" });
    await action.run({ id: "rec-1" });
    expect(state.row?.archivedAt).toBeNull();

    expect(restoredEvents()).toHaveLength(0);
  });

  it("reports one restore when two restore requests overlap", async () => {
    row("processing");

    await Promise.all([
      action.run({ id: "rec-1" }),
      action.run({ id: "rec-1" }),
    ]);

    expect(restoredEvents()).toHaveLength(1);
  });

  it("still restores when tracking throws", async () => {
    state.track.mockImplementation(() => {
      throw new Error("tracker down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    row("uploading");

    await expect(action.run({ id: "rec-1" })).resolves.toEqual({ id: "rec-1" });
    expect(state.row?.trashedAt).toBeNull();
    warn.mockRestore();
  });
});
