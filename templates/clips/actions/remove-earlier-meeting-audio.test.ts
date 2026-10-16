import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  transcriptWrites: [] as Array<Array<Record<string, unknown>>>,
  sets: [] as Array<{ table: string; values: Record<string, unknown> }>,
  deletes: [] as string[],
  assertAccess: vi.fn(),
  writeAppState: vi.fn(),
  dispatchPostFinalizeJob: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  isNull: vi.fn((column: unknown) => ({ isNull: column })),
  sql: vi.fn(() => ({ sql: true })),
}));

function table(name: string, columns: string[]) {
  return Object.fromEntries([
    ["_name", name],
    ...columns.map((column) => [column, `${name}.${column}`]),
  ]);
}

vi.mock("../server/db/index.js", () => {
  const tx = {
    update: (target: { _name: string }) => ({
      set: (values: Record<string, unknown>) => {
        mocks.sets.push({ table: target._name, values });
        return {
          where: () => ({
            returning: async () =>
              mocks.transcriptWrites.shift() ?? [{ recordingId: "rec-1" }],
          }),
        };
      },
    }),
    delete: (target: { _name: string }) => ({
      where: async () => {
        mocks.deletes.push(target._name);
      },
    }),
  };
  return {
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => mocks.rows.shift() ?? [] }),
        }),
      }),
      transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
    }),
    schema: {
      meetings: table("meetings", ["id", "recordingId", "actualEnd"]),
      meetingActionItems: table("meetingActionItems", ["meetingId"]),
      recordings: table("recordings", ["id", "titleSource"]),
      recordingTranscripts: table("recordingTranscripts", [
        "recordingId",
        "segmentsJson",
        "updatedAt",
        "earlierAudioMs",
        "earlierAudioRemovedAt",
      ]),
    },
  };
});

vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mocks.dispatchPostFinalizeJob(...args),
}));

import removeEarlierMeetingAudio from "./remove-earlier-meeting-audio";

const earlier = {
  startMs: 0,
  endMs: 2_000,
  text: "Before the call.",
  source: "mic",
  earlier: true,
};
const live = {
  startMs: 400_000,
  endMs: 401_000,
  text: "Live words.",
  source: "system",
};

function transcript(
  segments: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    segmentsJson: JSON.stringify(segments),
    updatedAt: "2026-10-16T10:00:00.000Z",
    earlierAudioMs: 300_000,
    earlierAudioRemovedAt: null,
    ...overrides,
  };
}

const endedMeeting = {
  recordingId: "rec-1",
  actualEnd: "2026-10-16T11:00:00.000Z",
};

function setOn(name: string) {
  return mocks.sets.filter((set) => set.table === name);
}

describe("remove-earlier-meeting-audio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.transcriptWrites = [];
    mocks.sets = [];
    mocks.deletes = [];
  });

  it("removes the earlier segments and everything written from them", async () => {
    mocks.rows = [[endedMeeting], [transcript([earlier, live])]];

    const result = await removeEarlierMeetingAudio.run({
      meetingId: "meeting-1",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "meeting",
      "meeting-1",
      "editor",
    );
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec-1",
      "editor",
    );
    const [written] = setOn("recordingTranscripts");
    expect(JSON.parse(written.values.segmentsJson as string)).toEqual([live]);
    expect(written.values.fullText).toBe("Them: Live words.");
    expect(written.values.earlierAudioRemovedAt).toEqual(expect.any(String));
    expect(setOn("meetings")[0].values).toMatchObject({
      summaryMd: "",
      bulletsJson: "[]",
      actionItemsJson: "[]",
      transcriptStatus: "ready",
    });
    expect(mocks.deletes).toEqual(["meetingActionItems"]);
    expect(setOn("recordings")[0].values).toMatchObject({ description: "" });
    expect(mocks.dispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "rec-1",
      kind: "transcript",
    });
    expect(result).toEqual({
      meetingId: "meeting-1",
      recordingId: "rec-1",
      status: "removed",
      removedSegments: 1,
      followUp: "queued",
    });
  });

  it("leaves a live meeting's notes to be written when it ends", async () => {
    mocks.rows = [
      [{ recordingId: "rec-1", actualEnd: null }],
      [transcript([earlier, live])],
    ];

    const result = await removeEarlierMeetingAudio.run({
      meetingId: "meeting-1",
    });

    expect(setOn("meetings")[0].values).not.toHaveProperty("transcriptStatus");
    expect(mocks.dispatchPostFinalizeJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ followUp: "after-meeting-ends" });
  });

  it("retries against a live save that lands between its read and write", async () => {
    const later = { ...live, startMs: 402_000, endMs: 403_000, text: "More." };
    mocks.rows = [
      [endedMeeting],
      [transcript([earlier, live])],
      [
        transcript([earlier, live, later], {
          updatedAt: "2026-10-16T10:00:02.000Z",
        }),
      ],
    ];
    mocks.transcriptWrites = [[], [{ recordingId: "rec-1" }]];

    const result = await removeEarlierMeetingAudio.run({
      meetingId: "meeting-1",
    });

    const writes = setOn("recordingTranscripts");
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1].values.segmentsJson as string)).toEqual([
      live,
      later,
    ]);
    expect(setOn("meetings")).toHaveLength(1);
    expect(result).toMatchObject({ status: "removed" });
  });

  it("marks the notes failed and queues nothing when no audio is left", async () => {
    mocks.rows = [[endedMeeting], [transcript([earlier])]];

    const result = await removeEarlierMeetingAudio.run({
      meetingId: "meeting-1",
    });

    expect(setOn("meetings")[0].values).toMatchObject({
      transcriptStatus: "failed",
    });
    expect(mocks.dispatchPostFinalizeJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ followUp: "nothing-left" });
  });

  it("reports a rewrite that could not be queued", async () => {
    mocks.rows = [[endedMeeting], [transcript([earlier, live])]];
    mocks.dispatchPostFinalizeJob.mockRejectedValueOnce(new Error("offline"));

    const result = await removeEarlierMeetingAudio.run({
      meetingId: "meeting-1",
    });

    expect(result).toMatchObject({ status: "removed", followUp: "failed" });
  });

  it("changes nothing when the audio was already removed", async () => {
    mocks.rows = [
      [endedMeeting],
      [
        transcript([live], {
          earlierAudioRemovedAt: "2026-10-16T10:30:00.000Z",
        }),
      ],
    ];

    const result = await removeEarlierMeetingAudio.run({
      meetingId: "meeting-1",
    });

    expect(result).toMatchObject({ status: "already-removed" });
    expect(mocks.sets).toEqual([]);
  });

  it("fails when the meeting has no earlier audio", async () => {
    mocks.rows = [
      [endedMeeting],
      [transcript([live], { earlierAudioMs: null })],
    ];

    await expect(
      removeEarlierMeetingAudio.run({ meetingId: "meeting-1" }),
    ).rejects.toThrow("no audio from before notes started");
    expect(mocks.sets).toEqual([]);
  });
});
