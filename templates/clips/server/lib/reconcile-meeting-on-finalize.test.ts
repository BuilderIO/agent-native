import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  foundMeeting: null as {
    id: string;
    actualEnd: string | null;
    summaryMd: string;
  } | null,
  updateSets: [] as Array<Record<string, unknown>>,
}));
const mockDispatchPostFinalizeJob = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => {}),
);

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
      summaryMd: "meetings.summaryMd",
      trashedAt: "meetings.trashedAt",
    },
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () =>
          state.foundMeeting ? [state.foundMeeting] : [],
        ),
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

vi.mock("./post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mockDispatchPostFinalizeJob(...args),
}));

import {
  reconcileMeetingOnRecordingFailedBestEffort,
  reconcileMeetingOnRecordingFailed,
  reconcileMeetingOnRecordingReady,
} from "./reconcile-meeting-on-finalize";

describe("reconcileMeetingOnRecordingReady", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.foundMeeting = null;
    state.updateSets = [];
  });

  it("stamps actualEnd on the still-live linked meeting", async () => {
    state.foundMeeting = { id: "meeting_1", actualEnd: null, summaryMd: "" };

    await reconcileMeetingOnRecordingReady({
      recordingId: "rec_1",
      ownerEmail: "owner@example.com",
      endedAtIso: "2026-07-06T08:45:00.000Z",
    });

    expect(state.updateSets).toEqual([
      expect.objectContaining({ actualEnd: "2026-07-06T08:45:00.000Z" }),
    ]);
    expect(mockDispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "rec_1",
      kind: "meeting-finalize",
      requireAccepted: true,
    });
  });

  it("re-dispatches finalization for a meeting that ended before the recording became ready", async () => {
    state.foundMeeting = {
      id: "meeting_1",
      actualEnd: "2026-07-06T08:40:00.000Z",
      summaryMd: "",
    };

    await reconcileMeetingOnRecordingReady({
      recordingId: "rec_1",
      ownerEmail: "owner@example.com",
      endedAtIso: "2026-07-06T08:45:00.000Z",
    });

    expect(state.updateSets).toEqual([]);
    expect(mockDispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "rec_1",
      kind: "meeting-finalize",
      requireAccepted: true,
    });
  });

  it("surfaces a rejected durable finalization dispatch", async () => {
    state.foundMeeting = { id: "meeting_1", actualEnd: null, summaryMd: "" };
    mockDispatchPostFinalizeJob.mockRejectedValueOnce(
      new Error("worker dispatch unavailable"),
    );

    await expect(
      reconcileMeetingOnRecordingReady({
        recordingId: "rec_1",
        ownerEmail: "owner@example.com",
        endedAtIso: "2026-07-06T08:45:00.000Z",
      }),
    ).rejects.toThrow("worker dispatch unavailable");
  });

  it("does nothing when the recording has no still-live linked meeting", async () => {
    state.foundMeeting = null;

    await reconcileMeetingOnRecordingReady({
      recordingId: "rec_2",
      ownerEmail: "owner@example.com",
      endedAtIso: "2026-07-06T08:45:00.000Z",
    });

    expect(state.updateSets).toEqual([]);
    expect(mockDispatchPostFinalizeJob).not.toHaveBeenCalled();
  });

  it("dispatches an already-ended meeting when its recording fails", async () => {
    state.foundMeeting = {
      id: "meeting_1",
      actualEnd: "2026-07-06T08:40:00.000Z",
      summaryMd: "",
    };

    await reconcileMeetingOnRecordingFailed({
      recordingId: "rec_1",
      ownerEmail: "owner@example.com",
    });

    expect(state.updateSets).toEqual([]);
    expect(mockDispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "rec_1",
      kind: "meeting-finalize",
      requireAccepted: true,
    });
  });

  it("does not end an active meeting when its recording upload fails", async () => {
    state.foundMeeting = { id: "meeting_1", actualEnd: null, summaryMd: "" };

    await reconcileMeetingOnRecordingFailed({
      recordingId: "rec_1",
      ownerEmail: "owner@example.com",
    });

    expect(state.updateSets).toEqual([]);
    expect(mockDispatchPostFinalizeJob).not.toHaveBeenCalled();
  });

  it("keeps upload failure handling intact when finalization dispatch fails", async () => {
    state.foundMeeting = {
      id: "meeting_1",
      actualEnd: "2026-07-06T08:40:00.000Z",
      summaryMd: "",
    };
    mockDispatchPostFinalizeJob.mockRejectedValueOnce(
      new Error("worker dispatch unavailable"),
    );
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await expect(
        reconcileMeetingOnRecordingFailedBestEffort({
          recordingId: "rec_1",
          ownerEmail: "owner@example.com",
        }),
      ).resolves.toBeUndefined();
      expect(consoleWarn).toHaveBeenCalledWith(
        "[clips-meeting] finalization dispatch failed after upload failure",
        {
          recordingId: "rec_1",
          error: "worker dispatch unavailable",
        },
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
