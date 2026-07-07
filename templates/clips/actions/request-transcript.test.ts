import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectRows = vi.hoisted(() => ({
  queue: [] as Array<Array<Record<string, unknown>>>,
}));
const mockInsertValues = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn(async () => undefined));
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mockSelectRows.queue.shift() ?? []),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: mockInsertValues,
  })),
  update: vi.fn(() => ({
    set: mockUpdateSet,
  })),
}));
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockGetSetting = vi.hoisted(() => vi.fn());
const mockGetUserSetting = vi.hoisted(() => vi.fn());
const mockFetchLoomTranscript = vi.hoisted(() => vi.fn());
const mockExportToBrainRun = vi.hoisted(() => vi.fn());
const mockCleanupTranscriptRun = vi.hoisted(() => vi.fn());
const mockRegenerateTitleRun = vi.hoisted(() => vi.fn());
const mockQueueTitleRegenerationRequest = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getUserSetting: (...args: unknown[]) => mockGetUserSetting(...args),
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  getCredentialContext: vi.fn(() => null),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveHasBuilderPrivateKey: vi.fn(async () => false),
}));

vi.mock("@agent-native/core/transcription/builder", () => ({
  transcribeWithBuilder: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      title: "recordings.title",
      titleSource: "recordings.titleSource",
      durationMs: "recordings.durationMs",
      videoUrl: "recordings.videoUrl",
      videoFormat: "recordings.videoFormat",
      hasAudio: "recordings.hasAudio",
      sourceAppName: "recordings.sourceAppName",
      sourceWindowTitle: "recordings.sourceWindowTitle",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
      status: "recordingTranscripts.status",
      fullText: "recordingTranscripts.fullText",
      segmentsJson: "recordingTranscripts.segmentsJson",
      updatedAt: "recordingTranscripts.updatedAt",
      language: "recordingTranscripts.language",
    },
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: vi.fn(() => "owner@example.com"),
  ownerEmailMatches: (column: unknown, email: string) => ({
    column,
    email,
    kind: "ownerEmailMatches",
  }),
}));

vi.mock("./regenerate-title.js", () => ({
  default: { run: (...args: unknown[]) => mockRegenerateTitleRun(...args) },
  queueTitleRegenerationRequest: (...args: unknown[]) =>
    mockQueueTitleRegenerationRequest(...args),
}));

vi.mock("./export-to-brain.js", () => ({
  default: { run: (...args: unknown[]) => mockExportToBrainRun(...args) },
}));

vi.mock("./cleanup-transcript.js", () => ({
  default: { run: (...args: unknown[]) => mockCleanupTranscriptRun(...args) },
}));

vi.mock("./lib/agents-md-context.js", () => ({
  loadAgentsMdContext: vi.fn(async () => ""),
}));

vi.mock("./lib/audio-only-transcription.js", () => ({
  AudioOnlyExtractionError: class AudioOnlyExtractionError extends Error {},
  assertAudioHasAudibleSignal: vi.fn(),
  isNoExtractableAudioError: vi.fn(() => false),
  prepareAudioOnlyTranscriptionMedia: vi.fn(),
}));

vi.mock("./lib/loom-transcript.js", () => ({
  fetchLoomTranscript: (...args: unknown[]) => mockFetchLoomTranscript(...args),
  loomTranscriptUnavailableMessage: () => "Loom transcript unavailable.",
}));

import { importLoomTranscriptForRecording } from "./request-transcript";

const existingSegments = JSON.stringify([
  { startMs: 0, endMs: 1200, text: "Saved transcript." },
]);

describe("importLoomTranscriptForRecording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.queue = [];
    mockGetSetting.mockResolvedValue({ transcriptCleanupEnabled: true });
    mockGetUserSetting.mockResolvedValue({ transcriptCleanupEnabled: false });
    mockFetchLoomTranscript.mockRejectedValue(
      new Error("temporary Loom error"),
    );
    mockExportToBrainRun.mockResolvedValue({ status: "skipped" });
    mockCleanupTranscriptRun.mockResolvedValue({
      cleanedText: "Saved transcript.",
      provider: "test",
    });
  });

  it("preserves an existing ready transcript when Loom refresh fails", async () => {
    mockSelectRows.queue = [
      [
        {
          status: "ready",
          fullText: "Saved transcript.",
          segmentsJson: existingSegments,
        },
      ],
      [
        {
          title: "Human title",
          titleSource: "manual",
          durationMs: 1200,
        },
      ],
    ];

    const result = await importLoomTranscriptForRecording({
      db: mockDb as any,
      recordingId: "rec_loom",
      ownerEmail: "owner@example.com",
      recording: {
        videoUrl: "https://www.loom.com/embed/abcDEF_123456",
        sourceAppName: "Loom",
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        durationMs: 1200,
      },
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      recordingId: "rec_loom",
      status: "ready",
      provider: "existing",
      preserved: true,
    });
    expect(mockFetchLoomTranscript).toHaveBeenCalledWith({
      shareUrl: "https://www.loom.com/share/abcDEF_123456",
      durationMs: 1200,
    });
    await vi.waitFor(() =>
      expect(mockGetUserSetting).toHaveBeenCalledWith(
        "owner@example.com",
        "clips-user-prefs",
      ),
    );
    expect(mockGetSetting).not.toHaveBeenCalled();
    expect(mockCleanupTranscriptRun).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("still records a failed Loom transcript when there is nothing ready to preserve", async () => {
    mockSelectRows.queue = [[], []];

    const result = await importLoomTranscriptForRecording({
      db: mockDb as any,
      recordingId: "rec_loom",
      ownerEmail: "owner@example.com",
      recording: {
        videoUrl: "https://www.loom.com/embed/abcDEF_123456",
        sourceAppName: "Loom",
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        durationMs: 1200,
      },
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      recordingId: "rec_loom",
      status: "failed",
      provider: "loom",
      failureReason: "Loom transcript unavailable.",
    });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "rec_loom",
        status: "failed",
        fullText: "",
        segmentsJson: "[]",
      }),
    );
  });
});
