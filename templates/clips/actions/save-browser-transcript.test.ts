import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  update: vi.fn(),
  insert: vi.fn(),
  writeAppState: vi.fn(),
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

import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import saveBrowserTranscript from "./save-browser-transcript";

describe("save-browser-transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
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
    // Recording already has a title and summary: only the truncation itself
    // should still dispatch the transcript job that runs the cloud fallback.
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

  // macos-native and web-speech are mic-only engines (see
  // transcription-engine.ts), so a fullText-only save from either can only be
  // the mic. Without a source the UI defaults the whole transcript to "Them".
  //
  // This covers the action's own contract, not the desktop meeting flush:
  // `transcriptSegments` now always sends at least one segment per line, so
  // the desktop no longer reaches this branch. The reachable callers are the
  // web recorder, the Chrome extension, and agent/CLI `save-browser-transcript`
  // calls, whose `segments` argument is optional.
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
