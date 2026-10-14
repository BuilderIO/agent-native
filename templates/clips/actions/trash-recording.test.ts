import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as null | {
    id: string;
    status: string;
    trashedAt: string | null;
    recordingPlatform: string | null;
  },
  track: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
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
  ne: () => ({ notReady: true }),
}));
vi.mock("../server/db/index.js", () => ({
  schema: {
    recordings: {
      id: "id",
      status: "status",
      trashedAt: "trashed_at",
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
      set: (values: { trashedAt: string }) => ({
        where: async (condition: { and?: unknown[] }) => {
          if (!state.row) return;
          const skipReady = Array.isArray(condition?.and);
          if (skipReady && state.row.status === "ready") return;
          state.row.trashedAt = values.trashedAt;
        },
      }),
    }),
  }),
}));

import trashRecording from "./trash-recording";

const action = trashRecording as unknown as {
  run: (args: { id: string; skipIfReady?: boolean }) => Promise<unknown>;
};
const discarded = () =>
  state.track.mock.calls.filter(([name]) => name === "recording_discarded");

function row(status: string, trashedAt: string | null = null) {
  state.row = { id: "rec-1", status, trashedAt, recordingPlatform: "web" };
}

describe("trash-recording recording_discarded", () => {
  beforeEach(() => {
    state.track.mockReset();
    state.row = null;
  });

  it("closes the funnel once when a row that never became ready is trashed", async () => {
    row("uploading");

    await action.run({ id: "rec-1", skipIfReady: true });

    expect(discarded()).toEqual([
      [
        "recording_discarded",
        {
          app_name: "clips",
          template_name: "clips",
          output_id: "rec-1",
          output_type: "clip",
          recording_platform: "web",
          status_at_discard: "uploading",
        },
        expect.objectContaining({ userId: "owner@example.com" }),
      ],
    ]);
  });

  it("does not fire for a ready clip, an already-trashed row, or a skipped ready row", async () => {
    row("ready");
    await action.run({ id: "rec-1" });

    row("failed", "2026-10-01T00:00:00.000Z");
    await action.run({ id: "rec-1" });

    row("ready");
    await action.run({ id: "rec-1", skipIfReady: true });

    expect(discarded()).toHaveLength(0);
  });

  it("still trashes when tracking throws", async () => {
    state.track.mockImplementation(() => {
      throw new Error("tracker down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    row("processing");

    await expect(action.run({ id: "rec-1" })).resolves.toMatchObject({
      skipped: false,
    });
    expect(state.row?.trashedAt).toBeTruthy();
    warn.mockRestore();
  });
});
