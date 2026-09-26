import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  update: vi.fn(),
  insert: vi.fn(),
  track: vi.fn(),
  writeAppState: vi.fn(),
  finalizeEndedMeetingsForRecording: vi.fn(),
}));

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mocks.rows.shift() ?? []),
      })),
    })),
  })),
  update: (...args: unknown[]) => mocks.update(...args),
  insert: (...args: unknown[]) => mocks.insert(...args),
};

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mocks.track(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({ resource: { id: "rec-1" } })),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      title: "recordings.title",
      titleSource: "recordings.titleSource",
      description: "recordings.description",
      status: "recordings.status",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
      status: "recordingTranscripts.status",
      fullText: "recordingTranscripts.fullText",
      segmentsJson: "recordingTranscripts.segmentsJson",
    },
  },
}));

vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: vi.fn(),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("./lib/finalize-ended-meetings.js", () => ({
  finalizeEndedMeetingsForRecording: (...args: unknown[]) =>
    mocks.finalizeEndedMeetingsForRecording(...args),
}));

import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import saveBrowserTranscript from "./save-browser-transcript";

describe("save-browser-transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
  });

  it("asserts editor access on the recording before mutating", async () => {
    const { assertAccess } = await import("@agent-native/core/sharing");
    const values = vi.fn();
    mocks.insert.mockReturnValue({ values });
    mocks.rows = [[], [{ status: "ready", title: "Clip", description: "x" }]];

    await saveBrowserTranscript.run({
      recordingId: "rec-1",
      fullText: "Testing access",
      source: "web-speech",
    });

    expect(assertAccess).toHaveBeenCalledWith("recording", "rec-1", "editor");
  });

  it("attributes transcript completion to the recording owner without request context", async () => {
    mocks.rows = [
      [],
      [{ status: "ready", title: "Clip", description: "x", durationMs: 1200 }],
    ];
    mocks.insert.mockReturnValue({ values: vi.fn() });

    await saveBrowserTranscript.run({
      recordingId: "rec-1",
      fullText: "Private transcript text is not asserted here.",
      source: "web-speech",
    });

    expect(mocks.track).toHaveBeenCalledWith(
      "recording_completed",
      expect.objectContaining({ app_name: "clips", output_id: "rec-1" }),
      { userId: "owner@example.com" },
    );
  });

  it("does not overwrite a pending cloud transcription with an empty native result", async () => {
    mocks.rows = [
      [
        {
          recordingId: "rec-1",
          status: "pending",
          fullText: "",
          segmentsJson: "[]",
        },
      ],
    ];

    const result = await saveBrowserTranscript.run({
      recordingId: "rec-1",
      fullText: "",
      source: "whisper",
      failureReason: "Native transcription returned no speech.",
    });

    expect(result).toEqual({
      recordingId: "rec-1",
      status: "skipped",
      reason: "Transcript attempt already exists",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not create a failed row before recording finalization", async () => {
    mocks.rows = [[]];

    const result = await saveBrowserTranscript.run({
      recordingId: "rec-1",
      fullText: "",
      source: "web-speech",
      failureReason: "Browser native transcription returned no speech.",
    });

    expect(result).toEqual({
      recordingId: "rec-1",
      status: "skipped",
      reason: "Empty native transcript; waiting for recording finalization",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("keeps a truncated capture out of 'ready' so the cloud fallback still runs", async () => {
    const values = vi.fn();
    mocks.insert.mockReturnValue({ values });
    mocks.rows = [[], [{ status: "ready", title: "Clip", description: "x" }]];
    vi.mocked(dispatchPostFinalizeJob).mockResolvedValue(undefined);

    const result = await saveBrowserTranscript.run({
      recordingId: "rec-1",
      fullText: "Only the first few lines",
      source: "web-speech",
      failureReason: "Speech recognition stopped early and could not restart.",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        fullText: "Only the first few lines",
        status: "failed",
        failureReason:
          "Speech recognition stopped early and could not restart.",
      }),
    );
    expect(result).toMatchObject({ status: "failed", truncated: true });
  });

  it.each([
    ["macos-native", "mic"],
    ["web-speech", "mic"],
  ] as const)(
    "tags synthesized segments as mic for the %s engine when no segments are supplied",
    async (source, expectedSpeakerSource) => {
      const values = vi.fn();
      mocks.insert.mockReturnValue({ values });
      mocks.rows = [[], [{ status: "ready", title: "Clip", description: "x" }]];

      await saveBrowserTranscript.run({
        recordingId: "rec-1",
        fullText: "Hello there, this is a test.",
        source,
        overwriteReady: true,
      });

      const inserted = values.mock.calls[0][0] as { segmentsJson: string };
      const segments = JSON.parse(inserted.segmentsJson);
      expect(segments.length).toBeGreaterThan(0);
      for (const segment of segments) {
        expect(segment.source).toBe(expectedSpeakerSource);
      }
    },
  );

  it("round-trips a caller-supplied diarized speaker into segmentsJson", async () => {
    const values = vi.fn();
    mocks.insert.mockReturnValue({ values });
    mocks.rows = [[], [{ status: "ready", title: "Clip", description: "x" }]];

    await saveBrowserTranscript.run({
      recordingId: "rec-1",
      fullText: "Hello there. General Kenobi.",
      source: "whisper",
      overwriteReady: true,
      segments: [
        { startMs: 0, endMs: 1_000, text: "Hello there.", speaker: "Alice" },
        {
          startMs: 1_000,
          endMs: 2_000,
          text: "General Kenobi.",
          source: "system",
          speaker: "Bob",
        },
      ],
    });

    const inserted = values.mock.calls[0][0] as { segmentsJson: string };
    expect(JSON.parse(inserted.segmentsJson)).toEqual([
      expect.objectContaining({ text: "Hello there.", speaker: "Alice" }),
      expect.objectContaining({ text: "General Kenobi.", speaker: "Bob" }),
    ]);
  });

  it("leaves synthesized segments source-less for whisper (mixed mic + system)", async () => {
    const values = vi.fn();
    mocks.insert.mockReturnValue({ values });
    mocks.rows = [[], [{ status: "ready", title: "Clip", description: "x" }]];

    await saveBrowserTranscript.run({
      recordingId: "rec-1",
      fullText: "Hello there, this is a test.",
      source: "whisper",
      overwriteReady: true,
    });

    const inserted = values.mock.calls[0][0] as { segmentsJson: string };
    const segments = JSON.parse(inserted.segmentsJson);
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.source).toBeUndefined();
    }
  });
});
