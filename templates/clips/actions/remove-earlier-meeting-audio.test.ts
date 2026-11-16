import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  dispatch: vi.fn(),
  finalize: vi.fn(),
  listEnded: vi.fn(),
  writeAppState: vi.fn(),
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  deleted: [] as string[],
  clearedMeetings: [] as Array<{ id: string }>,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("../server/db/index.js", () => {
  const select = () => {
    let table = "";
    const builder = {
      from: (source: { table: string }) => {
        table = source.table;
        return builder;
      },
      where: () => builder,
      limit: async () => mocks.rows[table] ?? [],
      for: async () => mocks.rows[table] ?? [],
      then: (resolve: (rows: unknown[]) => unknown) =>
        resolve(mocks.rows[table] ?? []),
    };
    return builder;
  };
  const tx = {
    select,
    update: (source: { table: string }) => ({
      set: (patch: Record<string, unknown>) => {
        mocks.writes.push({ table: source.table, patch });
        const done = Promise.resolve([]);
        return {
          where: () =>
            Object.assign(done, {
              returning: async () =>
                source.table === "meetings" ? mocks.clearedMeetings : [],
            }),
        };
      },
    }),
    delete: (source: { table: string }) => ({
      where: async () => {
        mocks.deleted.push(source.table);
      },
    }),
  };
  const column = (table: string, name: string) => `${table}.${name}`;
  const columns = (table: string, names: string[]) => ({
    table,
    ...Object.fromEntries(names.map((name) => [name, column(table, name)])),
  });
  return {
    getDb: () => ({
      ...tx,
      transaction: async (run: (inner: typeof tx) => unknown) => run(tx),
    }),
    schema: {
      meetings: columns("meetings", [
        "id",
        "title",
        "recordingId",
        "actualEnd",
        "trashedAt",
      ]),
      meetingActionItems: columns("meetingActionItems", ["meetingId"]),
      recordings: columns("recordings", ["id", "status", "titleSource"]),
      recordingTranscripts: columns("transcripts", [
        "recordingId",
        "segmentsJson",
      ]),
      recordingTranscriptVersions: columns("versions", [
        "id",
        "recordingId",
        "segmentsJson",
      ]),
    },
  };
});

vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) => mocks.dispatch(...args),
}));

vi.mock("./finalize-meeting.js", () => ({
  default: { run: (...args: unknown[]) => mocks.finalize(...args) },
}));

vi.mock("./lib/finalize-ended-meetings.js", () => ({
  listEndedMeetingsForRecording: (...args: unknown[]) =>
    mocks.listEnded(...args),
}));

import { ForbiddenError } from "@agent-native/core/sharing";

import removeEarlierMeetingAudio from "./remove-earlier-meeting-audio";

const earlier = {
  startMs: 0,
  endMs: 300_000,
  text: "private chat before the call",
  source: "system",
  recovered: true,
};
const live = {
  startMs: 300_000,
  endMs: 310_000,
  text: "the meeting itself",
  source: "mic",
};

function writesTo(table: string) {
  return mocks.writes.filter((write) => write.table === table);
}

function run() {
  return removeEarlierMeetingAudio.run({ meetingId: "meeting-1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes.length = 0;
  mocks.deleted.length = 0;
  mocks.clearedMeetings = [{ id: "meeting-1" }];
  mocks.assertAccess.mockResolvedValue({
    role: "editor",
    resource: { expiresAt: null },
  });
  mocks.dispatch.mockResolvedValue(undefined);
  mocks.finalize.mockResolvedValue({ summaryMd: "rebuilt" });
  mocks.listEnded.mockResolvedValue([{ id: "meeting-1" }]);
  mocks.rows = {
    meetings: [
      {
        id: "meeting-1",
        title: "Weekly sync",
        recordingId: "recording-1",
        actualEnd: "2026-11-03T10:00:00.000Z",
      },
    ],
    recordings: [{ status: "ready", titleSource: "ai" }],
    transcripts: [{ segmentsJson: JSON.stringify([earlier, live]) }],
    versions: [],
  };
});

describe("remove-earlier-meeting-audio", () => {
  it("takes the audio out of the transcript and stays removed for later saves", async () => {
    await expect(run()).resolves.toEqual({
      meetingId: "meeting-1",
      removedSegments: 1,
      notes: "regenerated",
    });

    const [write] = writesTo("transcripts");
    expect(JSON.parse(write.patch.segmentsJson as string)).toEqual([live]);
    expect(write.patch.fullText).toBe("Me: the meeting itself");
    expect(write.patch.earlierAudioRemovedAt).toEqual(expect.any(String));
  });

  it("removes its contribution to the notes before rebuilding them", async () => {
    let notesWhenRebuilt: unknown;
    mocks.finalize.mockImplementation(async () => {
      notesWhenRebuilt = writesTo("meetings")[0]?.patch;
      return { summaryMd: "rebuilt" };
    });

    await run();

    expect(notesWhenRebuilt).toMatchObject({
      summaryMd: "",
      bulletsJson: "[]",
      actionItemsJson: "[]",
      transcriptStatus: "ready",
    });
    expect(mocks.deleted).toEqual(["meetingActionItems"]);
    expect(mocks.finalize).toHaveBeenCalledWith({
      meetingId: "meeting-1",
      force: true,
    });
  });

  it("resets the Clip metadata finalize would read the audio back from", async () => {
    await run();

    expect(writesTo("recordings")[0].patch).toMatchObject({
      description: "",
      chaptersJson: "[]",
      title: "Weekly sync",
      titleSource: "default",
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      recordingId: "recording-1",
      kind: "transcript",
    });
  });

  it("resets a title drawn from the transcript when no model was available", async () => {
    mocks.rows.recordings = [{ status: "ready", titleSource: "context" }];

    await run();

    expect(writesTo("recordings")[0].patch).toMatchObject({
      title: "Weekly sync",
      titleSource: "default",
    });
  });

  it("removes nothing when another meeting on the recording can't be edited", async () => {
    mocks.rows.meetings.push({ id: "private-meeting" });
    mocks.assertAccess.mockImplementation(async (_type, id) => {
      if (id === "private-meeting") throw new ForbiddenError();
      return { role: "editor", resource: { expiresAt: null } };
    });

    await expect(run()).rejects.toThrow("Another meeting you can't edit");

    expect(mocks.writes).toEqual([]);
    expect(mocks.deleted).toEqual([]);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it("keeps a title the user chose", async () => {
    mocks.rows.recordings = [{ status: "ready", titleSource: "manual" }];

    await run();

    const { patch } = writesTo("recordings")[0];
    expect(patch).toMatchObject({ description: "" });
    expect(patch).not.toHaveProperty("title");
  });

  it("takes it out of saved versions so a restore can't bring it back", async () => {
    mocks.rows.versions = [
      { id: "version-1", segmentsJson: JSON.stringify([earlier, live]) },
    ];

    await run();

    const [write] = writesTo("versions");
    expect(JSON.parse(write.patch.segmentsJson as string)).toEqual([live]);
    expect(write.patch.fullText).toBe("Me: the meeting itself");
  });

  it("leaves the notes of a meeting still running alone", async () => {
    mocks.rows.meetings[0].actualEnd = null;
    mocks.rows.recordings = [{ status: "uploading", titleSource: "default" }];
    mocks.clearedMeetings = [];
    mocks.listEnded.mockResolvedValue([]);

    await expect(run()).resolves.toMatchObject({ notes: "live" });

    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.deleted).toEqual([]);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rebuilds an ended meeting on the recording when this one is still running", async () => {
    mocks.rows.meetings[0].actualEnd = null;
    mocks.rows.recordings = [{ status: "uploading", titleSource: "default" }];
    mocks.clearedMeetings = [{ id: "meeting-2" }];
    mocks.listEnded.mockResolvedValue([{ id: "meeting-2" }]);

    await expect(run()).resolves.toMatchObject({ notes: "live" });

    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "recording-1",
        kind: "meeting-finalize",
      }),
    );
  });

  it("reports an empty transcript instead of asking for notes from nothing", async () => {
    mocks.rows.transcripts = [{ segmentsJson: JSON.stringify([earlier]) }];

    await expect(run()).resolves.toMatchObject({
      removedSegments: 1,
      notes: "empty",
    });

    expect(writesTo("transcripts")[0].patch.fullText).toBe("");
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("reports a failed rebuild while the removal itself stands", async () => {
    mocks.finalize.mockRejectedValue(new Error("model unavailable"));

    await expect(run()).resolves.toMatchObject({
      removedSegments: 1,
      notes: "failed",
    });

    expect(writesTo("transcripts")).toHaveLength(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "meeting-finalize" }),
    );
  });

  it("reports a rebuild another run already holds", async () => {
    mocks.finalize.mockResolvedValue({ skipped: "already-in-progress" });

    await expect(run()).resolves.toMatchObject({ notes: "regenerating" });
  });

  it("changes nothing when the transcript holds no earlier audio", async () => {
    mocks.rows.transcripts = [{ segmentsJson: JSON.stringify([live]) }];

    await expect(run()).resolves.toEqual({
      meetingId: "meeting-1",
      removedSegments: 0,
      notes: "unchanged",
    });

    expect(mocks.writes).toEqual([]);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it("fails loudly on a transcript it can't read", async () => {
    mocks.rows.transcripts = [{ segmentsJson: "not json" }];

    await expect(run()).rejects.toThrow("couldn't be read");

    expect(mocks.writes).toEqual([]);
  });

  it("requires editor access to the meeting and to its recording", async () => {
    await run();

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "meeting",
      "meeting-1",
      "editor",
    );
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "editor",
    );
  });
});
