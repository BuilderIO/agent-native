import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  foundMeeting: null as { id: string } | null,
  updateSets: [] as Array<Record<string, unknown>>,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
}));

vi.mock("../db/index.js", () => {
  const schema = {
    meetings: {
      id: "meetings.id",
      recordingId: "meetings.recordingId",
      ownerEmail: "meetings.ownerEmail",
      actualEnd: "meetings.actualEnd",
      trashedAt: "meetings.trashedAt",
    },
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: async () => (state.foundMeeting ? [state.foundMeeting] : []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        state.updateSets.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  return { getDb: () => db, schema };
});

import { reconcileMeetingOnRecordingReady } from "./reconcile-meeting-on-finalize";

describe("reconcileMeetingOnRecordingReady", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.foundMeeting = null;
    state.updateSets = [];
  });

  it("stamps actualEnd on the still-live linked meeting", async () => {
    state.foundMeeting = { id: "meeting_1" };

    await reconcileMeetingOnRecordingReady({
      recordingId: "rec_1",
      ownerEmail: "owner@example.com",
      endedAtIso: "2026-07-06T08:45:00.000Z",
    });

    expect(state.updateSets).toEqual([
      expect.objectContaining({ actualEnd: "2026-07-06T08:45:00.000Z" }),
    ]);
  });

  it("does nothing when the recording has no still-live linked meeting", async () => {
    state.foundMeeting = null;

    await reconcileMeetingOnRecordingReady({
      recordingId: "rec_2",
      ownerEmail: "owner@example.com",
      endedAtIso: "2026-07-06T08:45:00.000Z",
    });

    expect(state.updateSets).toEqual([]);
  });
});
