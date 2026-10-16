import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFinalizeMeeting = vi.hoisted(() => vi.fn());
const mockInArray = vi.hoisted(() => vi.fn(() => "inArray"));
const mockMeetings = vi.hoisted(() => [
  { id: "meeting-1" },
  { id: "meeting-2" },
]);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(async () => mockMeetings),
    };
    return builder;
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
  inArray: (...args: unknown[]) => mockInArray(...args),
  isNotNull: vi.fn(() => "isNotNull"),
}));

vi.mock("../../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    meetings: {
      id: "meetings.id",
      recordingId: "meetings.recordingId",
      actualEnd: "meetings.actualEnd",
      transcriptStatus: "meetings.transcriptStatus",
      summaryMd: "meetings.summaryMd",
    },
  },
}));

vi.mock("../finalize-meeting.js", () => ({
  default: { run: (...args: unknown[]) => mockFinalizeMeeting(...args) },
}));

import { finalizeEndedMeetingsForRecording } from "./finalize-ended-meetings.js";

describe("finalize ended meetings for recording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFinalizeMeeting.mockResolvedValue({ summaryMd: "Notes" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves best-effort behavior for existing callers", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFinalizeMeeting.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );

    await expect(
      finalizeEndedMeetingsForRecording(mockDb as never, "rec-1"),
    ).resolves.toBeUndefined();

    expect(mockFinalizeMeeting).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("reports finalizer exceptions to callers that need retries", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFinalizeMeeting.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );

    await expect(
      finalizeEndedMeetingsForRecording(mockDb as never, "rec-1", {
        throwOnFailure: true,
      }),
    ).rejects.toMatchObject({
      name: "AggregateError",
      message: "Failed to finalize 1 ended meeting(s) for recording rec-1",
    });

    expect(mockFinalizeMeeting).toHaveBeenCalledTimes(2);
    expect(mockFinalizeMeeting).toHaveBeenCalledWith({
      meetingId: "meeting-1",
      force: true,
    });
    expect(mockInArray).toHaveBeenCalledWith("meetings.transcriptStatus", [
      "ready",
      "failed",
      "pending",
    ]);
  });

  it("reports a skipped in-flight finalizer as retryable in strict mode", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFinalizeMeeting
      .mockResolvedValueOnce({ skipped: "already-in-progress" })
      .mockResolvedValueOnce({ summaryMd: "Notes" });

    await expect(
      finalizeEndedMeetingsForRecording(mockDb as never, "rec-1", {
        throwOnFailure: true,
      }),
    ).rejects.toMatchObject({ name: "AggregateError" });

    expect(mockFinalizeMeeting).toHaveBeenCalledTimes(2);
  });

  it("reports a missing transcript as retryable in strict mode", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFinalizeMeeting
      .mockResolvedValueOnce({ skipped: "no-transcript" })
      .mockResolvedValueOnce({ summaryMd: "Notes" });

    await expect(
      finalizeEndedMeetingsForRecording(mockDb as never, "rec-1", {
        throwOnFailure: true,
      }),
    ).rejects.toMatchObject({ name: "AggregateError" });

    expect(mockFinalizeMeeting).toHaveBeenCalledTimes(2);
  });
});
