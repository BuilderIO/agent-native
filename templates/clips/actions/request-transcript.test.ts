import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const mockRegenerateSummaryRun = vi.hoisted(() => vi.fn());
const mockQueueTitleRegenerationRequest = vi.hoisted(() => vi.fn());
const mockResolveHasBuilderPrivateKey = vi.hoisted(() => vi.fn());
const mockTranscribeWithBuilder = vi.hoisted(() => vi.fn());
const mockSsrfSafeFetch = vi.hoisted(() => vi.fn());
const mockPrepareAudioOnlyTranscriptionMedia = vi.hoisted(() => vi.fn());
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockDispatchPostFinalizeJob = vi.hoisted(() =>
  vi.fn(async () => undefined),
);

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
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  getCredentialContext: vi.fn(() => null),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveHasBuilderPrivateKey: (...args: unknown[]) =>
    mockResolveHasBuilderPrivateKey(...args),
}));

vi.mock("@agent-native/core/transcription/builder", () => ({
  transcribeWithBuilder: (...args: unknown[]) =>
    mockTranscribeWithBuilder(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
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
      description: "recordings.description",
      durationMs: "recordings.durationMs",
      videoUrl: "recordings.videoUrl",
      videoFormat: "recordings.videoFormat",
      videoSizeBytes: "recordings.videoSizeBytes",
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
      retryCount: "recordingTranscripts.retryCount",
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

vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: mockDispatchPostFinalizeJob,
}));

vi.mock("./regenerate-title.js", () => ({
  default: { run: (...args: unknown[]) => mockRegenerateTitleRun(...args) },
  queueTitleRegenerationRequest: (...args: unknown[]) =>
    mockQueueTitleRegenerationRequest(...args),
}));

vi.mock("./regenerate-summary.js", () => ({
  default: { run: (...args: unknown[]) => mockRegenerateSummaryRun(...args) },
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
  isTransientExtractionError: vi.fn(() => false),
  prepareAudioOnlyTranscriptionMedia: (...args: unknown[]) =>
    mockPrepareAudioOnlyTranscriptionMedia(...args),
}));

vi.mock("./lib/loom-transcript.js", () => ({
  fetchLoomTranscript: (...args: unknown[]) => mockFetchLoomTranscript(...args),
  loomTranscriptUnavailableMessage: () => "Loom transcript unavailable.",
}));

import {
  builderTranscriptionTimeoutMs,
  importLoomTranscriptForRecording,
  recordingMediaFetchTimeoutMs,
  transcribeWithBuilderModelFallback,
} from "./request-transcript";
import requestTranscript from "./request-transcript";

const existingSegments = JSON.stringify([
  { startMs: 0, endMs: 1200, text: "Saved transcript." },
]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("builderTranscriptionTimeoutMs", () => {
  it("keeps short or unknown recordings on the historical timeout", () => {
    expect(builderTranscriptionTimeoutMs(null)).toBe(45_000);
    expect(builderTranscriptionTimeoutMs(30_000)).toBe(45_000);
  });

  it("scales longer recordings without exceeding the Netlify function budget", () => {
    expect(builderTranscriptionTimeoutMs(15 * 60_000)).toBe(65_000);
  });

  it("allows an operator override while preserving safety bounds", () => {
    vi.stubEnv("CLIPS_BUILDER_TRANSCRIPTION_TIMEOUT_MS", "120000");
    expect(builderTranscriptionTimeoutMs(60_000)).toBe(65_000);

    vi.stubEnv("CLIPS_BUILDER_TRANSCRIPTION_TIMEOUT_MS", "50000");
    expect(builderTranscriptionTimeoutMs(60_000)).toBe(50_000);
  });
});

describe("recordingMediaFetchTimeoutMs", () => {
  it("gives long recordings enough time to download before extraction", () => {
    expect(recordingMediaFetchTimeoutMs(null, null)).toBe(45_000);
    expect(recordingMediaFetchTimeoutMs(250 * 1024 * 1024, null)).toBe(80_000);
    expect(recordingMediaFetchTimeoutMs(null, 55 * 60_000)).toBe(90_000);
  });

  it("allows a bounded operator override", () => {
    vi.stubEnv("CLIPS_TRANSCRIPTION_MEDIA_FETCH_TIMEOUT_MS", "100000");
    expect(recordingMediaFetchTimeoutMs(null, null)).toBe(100_000);

    vi.stubEnv("CLIPS_TRANSCRIPTION_MEDIA_FETCH_TIMEOUT_MS", "300000");
    expect(recordingMediaFetchTimeoutMs(null, null)).toBe(120_000);
  });
});

describe("Builder model fallback", () => {
  const options = {
    audioBytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/webm",
    diarize: false,
  };

  beforeEach(() => {
    mockTranscribeWithBuilder.mockReset();
  });

  it("retries with the Builder gateway default when the selected model is unavailable", async () => {
    const fallbackResult = {
      text: "Recovered transcript.",
      language: "en",
      durationSeconds: 1,
      segments: [],
    };
    mockTranscribeWithBuilder
      .mockRejectedValueOnce(
        new Error("Required AI model is not available in your region"),
      )
      .mockResolvedValueOnce(fallbackResult);

    await expect(transcribeWithBuilderModelFallback(options)).resolves.toEqual(
      fallbackResult,
    );
    expect(mockTranscribeWithBuilder).toHaveBeenNthCalledWith(1, {
      ...options,
      model: "gemini-3-1-flash-lite",
    });
    expect(mockTranscribeWithBuilder).toHaveBeenNthCalledWith(2, options);
  });

  it("does not duplicate non-model failures", async () => {
    const error = new Error("Builder transcription timed out after 45 seconds");
    mockTranscribeWithBuilder.mockRejectedValueOnce(error);

    await expect(transcribeWithBuilderModelFallback(options)).rejects.toBe(
      error,
    );
    expect(mockTranscribeWithBuilder).toHaveBeenCalledTimes(1);
  });
});

describe("requestTranscript regeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.queue = [];
    mockResolveHasBuilderPrivateKey.mockResolvedValue(true);
    mockAssertAccess.mockResolvedValue({ role: "editor" });
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(new Blob(["recording"], { type: "video/webm" })),
    );
    mockPrepareAudioOnlyTranscriptionMedia.mockResolvedValue({
      audioBytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm",
      filename: "recording.webm",
    });
    mockTranscribeWithBuilder.mockResolvedValue({
      text: "Fresh transcript.",
      language: "en",
      segments: [{ startMs: 0, endMs: 1200, text: "Fresh transcript." }],
    });
    mockExportToBrainRun.mockResolvedValue({ status: "skipped" });
    mockRegenerateSummaryRun.mockResolvedValue({ queued: true });
  });

  it("completes transcript-backed title and summary handoff before returning", async () => {
    mockGetUserSetting.mockResolvedValue({
      transcriptCleanupEnabled: false,
    });
    mockRegenerateTitleRun.mockResolvedValue({
      updated: true,
      summaryQueued: true,
    });
    mockSelectRows.queue = [
      [
        {
          status: "ready",
          fullText: "Opening filler before the actual product feedback.",
          segmentsJson: JSON.stringify([
            {
              startMs: 0,
              endMs: 1200,
              text: "Opening filler before the actual product feedback.",
            },
          ]),
          updatedAt: "2026-07-09T00:00:00.000Z",
          language: "en",
          retryCount: 0,
        },
      ],
      [
        {
          title: "Untitled recording",
          titleSource: "default",
          description: "",
          durationMs: 1200,
        },
      ],
    ];

    const result = await requestTranscript.run({
      recordingId: "rec_native",
    });

    expect(mockRegenerateTitleRun).toHaveBeenCalledWith({
      recordingId: "rec_native",
      transcriptText: "Opening filler before the actual product feedback.",
      includeSummary: true,
    });
    expect(result).toMatchObject({
      recordingId: "rec_native",
      status: "ready",
      cleanupQueued: false,
      titleQueued: true,
      summaryQueued: true,
    });
  });

  it("replaces a ready transcript when regeneration is explicitly requested", async () => {
    mockSelectRows.queue = [
      [
        {
          status: "ready",
          fullText: "Old transcript.",
          segmentsJson: JSON.stringify([
            { startMs: 0, endMs: 1200, text: "Old transcript." },
          ]),
          updatedAt: "2026-07-09T00:00:00.000Z",
          language: "en",
          retryCount: 0,
        },
      ],
      [
        {
          videoUrl: "https://cdn.example.com/recording.webm",
          videoFormat: "webm",
          hasAudio: true,
          durationMs: 1200,
          title: "Human title",
        },
      ],
      [{ recordingId: "rec_ready" }],
      [{ title: "Human title", titleSource: "manual" }],
    ];

    const result = await requestTranscript.run({
      recordingId: "rec_ready",
      force: true,
      regenerate: true,
    });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_ready",
      "editor",
    );
    expect(result).toMatchObject({
      recordingId: "rec_ready",
      status: "ready",
      provider: "builder",
    });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        fullText: "Fresh transcript.",
        failureReason: null,
      }),
    );
    expect(
      mockUpdateSet.mock.calls.some(
        ([patch]) => (patch as { status?: string }).status === "pending",
      ),
    ).toBe(false);
    expect(mockRegenerateSummaryRun).toHaveBeenCalledWith({
      recordingId: "rec_ready",
    });
  });

  it("keeps the ready transcript when regeneration fails", async () => {
    mockTranscribeWithBuilder.mockRejectedValue(
      new Error("Builder transcription failed (503 Service Unavailable)"),
    );
    mockSelectRows.queue = [
      [
        {
          status: "ready",
          fullText: "Saved transcript.",
          segmentsJson: existingSegments,
          updatedAt: "2026-07-09T00:00:00.000Z",
          language: "en",
          retryCount: 0,
        },
      ],
      [
        {
          videoUrl: "https://cdn.example.com/recording.webm",
          videoFormat: "webm",
          hasAudio: true,
          durationMs: 1200,
          title: "Human title",
        },
      ],
      [
        {
          status: "ready",
          fullText: "Saved transcript.",
          segmentsJson: existingSegments,
          language: "en",
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

    const result = await requestTranscript.run({
      recordingId: "rec_ready",
      force: true,
      regenerate: true,
    });

    expect(result).toMatchObject({
      recordingId: "rec_ready",
      status: "ready",
      provider: "existing",
      preserved: true,
    });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});

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
