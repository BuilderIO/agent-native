import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  existingRecording: {
    id: "rec_1",
    status: "uploading",
    videoUrl: null,
    videoSizeBytes: 0,
    durationMs: 0,
    width: 0,
    height: 0,
    hasAudio: true,
    hasCamera: false,
    title: "Test recording",
  },
  uploadState: null as Record<string, unknown> | null,
  chunkRows: [] as Array<{ key: string }>,
  selectRows: [] as Array<Array<Record<string, unknown>>>,
}));

const mockUploadFile = vi.hoisted(() => vi.fn());
const mockDispatchPostFinalizeJob = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockDeleteAppState = vi.hoisted(() => vi.fn());
const mockCompareAndSetAppState = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());
const mockUpdateReturning = vi.hoisted(() =>
  vi.fn(async () => [{ id: "rec_1" }]),
);
const mockUpdateWhere = vi.hoisted(() =>
  vi.fn(() => ({ returning: mockUpdateReturning })),
);
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => {
        const next = mockState.selectRows.shift();
        return next ?? [mockState.existingRecording];
      }),
    })),
  })),
  update: vi.fn(() => ({
    set: mockUpdateSet,
  })),
  insert: vi.fn(() => ({
    values: vi.fn(async () => undefined),
  })),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: (...args: unknown[]) =>
    mockCompareAndSetAppState(...args),
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
  deleteAppState: (...args: unknown[]) => mockDeleteAppState(...args),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mockDbExecute }),
  isPostgres: () => false,
}));

vi.mock("@agent-native/core/event-bus", () => ({
  emit: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProvider: vi.fn(() => null),
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  captureRouteError: vi.fn(),
  getRequestOrgId: vi.fn(() => undefined),
}));

vi.mock("@shared/upload-limits.js", () => ({
  MAX_UPLOAD_BYTES: 1024 * 1024 * 1024,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  isNull: vi.fn((column: unknown) => ({ column, kind: "isNull" })),
  ne: vi.fn((column: unknown, value: unknown) => ({
    column,
    value,
    kind: "ne",
  })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
      trashedAt: "recordings.trashedAt",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
    },
  },
}));

vi.mock("../server/lib/debug.js", () => ({
  debugLog: vi.fn(),
}));

vi.mock("../server/lib/builder-media-compression.js", () => ({
  queueBuilderMediaCompression: vi.fn(async () => ({
    queued: false,
    reason: "test",
  })),
}));

vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mockDispatchPostFinalizeJob(...args),
}));

vi.mock("../server/lib/faststart.js", () => ({
  applyFaststart: vi.fn((bytes: Uint8Array) => bytes),
  hasPlayableMp4Metadata: vi.fn(() => true),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: vi.fn(() => "owner@example.com"),
  ownerEmailMatches: (column: unknown, email: string) => ({
    column,
    email,
    kind: "ownerEmailMatches",
  }),
}));

vi.mock("../server/lib/resumable-session.js", () => ({
  deleteResumableSession: vi.fn(async () => undefined),
  getResumableSession: vi.fn(async () => null),
}));

vi.mock("../server/lib/resumable-upload-provider.js", () => ({
  resolveResumableUploadProvider: vi.fn(async () => null),
}));

vi.mock("../server/lib/streaming-upload-mode.js", () => ({
  isStreamingUploadDisabled: vi.fn(() => false),
}));

vi.mock("../server/lib/video-remux.js", () => ({
  probeHasAudioStream: vi.fn(async () => null),
  remuxWebmToSeekable: vi.fn(async (bytes: Uint8Array) => ({
    changed: false,
    bytes,
  })),
}));

vi.mock("../server/lib/video-storage.js", () => ({
  requiresConfiguredVideoStorage: vi.fn(() => false),
  STORAGE_SETUP_REQUIRED_REASON: "Storage required",
}));

vi.mock("./lib/ensure-seekable-video.js", () => ({
  ensureRecordingSeekable: vi.fn(),
  markRecordingSeekable: vi.fn(),
}));

import finalizeRecording from "./finalize-recording";

describe("finalize-recording chunk completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.uploadState = {
      expectedDataChunks: 3,
      mimeType: "video/webm",
      durationMs: 60_000,
    };
    mockState.chunkRows = [];
    mockState.selectRows = [];
    mockReadAppState.mockImplementation(async (key: string) => {
      if (key === "recording-upload-rec_1") return mockState.uploadState;
      return null;
    });
    mockDbExecute.mockImplementation(async () => ({
      rows: mockState.chunkRows,
      rowsAffected: 0,
    }));
  });

  it("fails before upload when persisted chunk indices have a gap", async () => {
    mockState.chunkRows = [
      { key: "recording-chunks-rec_1-000000" },
      { key: "recording-chunks-rec_1-000002" },
    ];

    await expect(finalizeRecording.run({ id: "rec_1" })).rejects.toThrow(
      "missing chunk 1",
    );

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureReason: expect.stringContaining("missing chunk 1"),
      }),
    );
  });

  it("fails before upload when final metadata expects more chunks", async () => {
    mockState.chunkRows = [
      { key: "recording-chunks-rec_1-000000" },
      { key: "recording-chunks-rec_1-000001" },
    ];

    await expect(finalizeRecording.run({ id: "rec_1" })).rejects.toThrow(
      "2 of 3 chunks received",
    );

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureReason: expect.stringContaining("2 of 3 chunks received"),
      }),
    );
  });
});

function seedBufferedRecording() {
  const chunkKeys = [
    "recording-chunks-rec_1-000000",
    "recording-chunks-rec_1-000001",
  ];
  const chunks = new Map([
    [chunkKeys[0], Buffer.from("video-").toString("base64")],
    [chunkKeys[1], Buffer.from("bytes").toString("base64")],
  ]);
  mockState.uploadState = {
    expectedDataChunks: 2,
    mimeType: "video/webm",
    durationMs: 1234,
    width: 1280,
    height: 720,
    hasAudio: true,
    hasCamera: false,
  };
  mockState.chunkRows = chunkKeys.map((key) => ({ key }));
  mockState.selectRows = [
    [{ ...mockState.existingRecording }],
    [{ status: "ready" }],
    [],
  ];
  mockReadAppState.mockImplementation(async (key: string) => {
    if (key === "recording-upload-rec_1") return mockState.uploadState;
    if (key === "recording-compression-rec_1") return null;
    const data = chunks.get(key);
    if (!data) return null;
    return {
      data,
      bytes: Buffer.from(data, "base64").byteLength,
      index: chunkKeys.indexOf(key),
    };
  });
  mockDbExecute.mockImplementation(async () => ({
    rows: mockState.chunkRows,
    rowsAffected: 0,
  }));
  return chunkKeys;
}

describe("finalize-recording media serve verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.uploadState = null;
    mockState.chunkRows = [];
    mockState.selectRows = [];
    mockWriteAppState.mockResolvedValue(undefined);
    mockDeleteAppState.mockResolvedValue(undefined);
    mockCompareAndSetAppState.mockResolvedValue(true);
    mockUpdateWhere.mockImplementation(() => ({
      returning: mockUpdateReturning,
    }));
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.builder.io/api/v1/file/assets%2Forg%2Frec_1",
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("keeps the recording processing and schedules durable verification when uploaded media stays unservable", async () => {
    const chunkKeys = seedBufferedRecording();
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 500 }));

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "rec_1",
        status: "processing",
        verificationPending: true,
      }),
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    );
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" }),
    );
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "recording-upload-rec_1",
      expect.objectContaining({
        recordingId: "rec_1",
        status: "processing",
        pendingMediaVerification: true,
        mediaVerificationAttempt: 0,
        mediaVerificationLastError: expect.stringMatching(
          /stored-but-unservable/i,
        ),
        mimeType: "video/webm",
        durationMs: 1234,
        width: 1280,
        height: 720,
        hasAudio: true,
        hasCamera: false,
      }),
    );
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "recording-media-verification-rec_1",
      expect.objectContaining({
        recordingId: "rec_1",
        status: "pending",
        completedAttempts: 0,
        leaseUntil: null,
      }),
    );
    expect(mockDispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "rec_1",
      kind: "media-ready",
      delayMs: 5_000,
      retryAttempt: 1,
      requireAccepted: true,
    });
    const markerWriteIndex = mockWriteAppState.mock.calls.findIndex(
      ([key]) => key === "recording-media-verification-rec_1",
    );
    expect(markerWriteIndex).toBeGreaterThanOrEqual(0);
    const markerWriteOrder =
      mockWriteAppState.mock.invocationCallOrder[markerWriteIndex];
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
      const deleteIndex = mockDeleteAppState.mock.calls.findIndex(
        ([deletedKey]) => deletedKey === key,
      );
      expect(markerWriteOrder).toBeLessThan(
        mockDeleteAppState.mock.invocationCallOrder[deleteIndex],
      );
    }
  });

  it("schedules durable verification when content-length exists without readable media bytes", async () => {
    const chunkKeys = seedBufferedRecording();
    vi.mocked(fetch).mockResolvedValue(
      new Response("", {
        status: 206,
        headers: { "content-length": "1024" },
      }),
    );

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "processing",
        verificationPending: true,
      }),
    );
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" }),
    );
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });

  it("accepts a readable provider generation that is smaller than the uploaded source", async () => {
    seedBufferedRecording();
    vi.mocked(fetch).mockResolvedValue(
      new Response("ok", {
        status: 206,
        headers: { "content-range": "bytes 0-1/2" },
      }),
    );

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "ready",
        sourceSizeBytes: 11,
        videoSizeBytes: 2,
      }),
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready", videoSizeBytes: 2 }),
    );
  });

  it("accepts readable media when storage omits a determinate byte count", async () => {
    const chunkKeys = seedBufferedRecording();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok", { status: 206 }));

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(result).toEqual(
      expect.objectContaining({ id: "rec_1", status: "ready" }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });

  it("does not retry a smaller readable provider generation", async () => {
    const chunkKeys = seedBufferedRecording();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("ok", {
          status: 206,
          headers: { "content-range": "bytes 0-1/2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("ok", {
          status: 206,
          headers: { "content-range": "bytes 0-1/11" },
        }),
      );

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(result).toEqual(
      expect.objectContaining({ id: "rec_1", status: "ready" }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });

  it("only reads one probe chunk when a server ignores the range request", async () => {
    const chunkKeys = seedBufferedRecording();
    let reads = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        reads += 1;
        controller.enqueue(new TextEncoder().encode("ok"));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-length": "11" },
      }),
    );

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "rec_1",
        status: "ready",
        sourceSizeBytes: 11,
      }),
    );
    expect(reads).toBe(1);
    expect(cancelled).toBe(true);
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });

  it("marks ready when media verification gets one 500 and then succeeds", async () => {
    const chunkKeys = seedBufferedRecording();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(
        new Response("ok", {
          status: 206,
          headers: { "content-range": "bytes 0-1/11" },
        }),
      );

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(result).toEqual(
      expect.objectContaining({ id: "rec_1", status: "ready" }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" }),
    );
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });

  it("skips verification for app-relative dev media URLs", async () => {
    const chunkKeys = seedBufferedRecording();
    mockUploadFile.mockResolvedValue({ url: "/api/uploads/rec_1/blob" });

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "rec_1",
        status: "ready",
        videoUrl: "/api/uploads/rec_1/blob",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });

  it("claims a due durable verification before promoting the recording", async () => {
    const marker = {
      recordingId: "rec_1",
      status: "pending",
      completedAttempts: 0,
      nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
      leaseUntil: null,
      updatedAt: new Date(Date.now() - 2_000).toISOString(),
    };
    mockState.uploadState = {
      pendingMediaVerification: true,
      mediaVerificationAttempt: 0,
      videoUrl: "https://cdn.example.com/rec_1",
      videoSizeBytes: 11,
      sourceSizeBytes: 11,
      videoFormat: "webm",
      durationMs: 1234,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasCamera: false,
      mimeType: "video/webm",
    };
    mockState.selectRows = [
      [
        {
          ...mockState.existingRecording,
          status: "processing",
          videoUrl: "https://cdn.example.com/rec_1",
        },
      ],
      [
        {
          status: "processing",
          videoUrl: "https://cdn.example.com/rec_1",
        },
      ],
      [],
    ];
    mockReadAppState.mockImplementation(async (key: string) => {
      if (key === "recording-upload-rec_1") return mockState.uploadState;
      if (key === "recording-media-verification-rec_1") return marker;
      return null;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response("ok", {
        status: 206,
        headers: { "content-range": "bytes 0-1/11" },
      }),
    );

    const result = await finalizeRecording.run({
      id: "rec_1",
      mediaVerificationRetryAttempt: 1,
    });

    expect(result).toEqual(expect.objectContaining({ status: "ready" }));
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "recording-media-verification-rec_1",
      marker,
      expect.objectContaining({
        status: "leased",
        leaseUntil: expect.any(String),
      }),
    );
    expect(mockDeleteAppState).toHaveBeenCalledWith(
      "recording-media-verification-rec_1",
    );
  });

  it("leaves a duplicate durable worker pending when it loses the lease", async () => {
    const marker = {
      recordingId: "rec_1",
      status: "pending",
      completedAttempts: 0,
      nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
      leaseUntil: null,
      updatedAt: new Date(Date.now() - 2_000).toISOString(),
    };
    mockState.uploadState = {
      pendingMediaVerification: true,
      mediaVerificationAttempt: 0,
      videoUrl: "https://cdn.example.com/rec_1",
      videoSizeBytes: 11,
      sourceSizeBytes: 11,
      videoFormat: "webm",
      durationMs: 1234,
    };
    mockState.selectRows = [
      [
        {
          ...mockState.existingRecording,
          status: "processing",
          videoUrl: "https://cdn.example.com/rec_1",
        },
      ],
    ];
    mockReadAppState.mockImplementation(async (key: string) => {
      if (key === "recording-upload-rec_1") return mockState.uploadState;
      if (key === "recording-media-verification-rec_1") return marker;
      return null;
    });
    mockCompareAndSetAppState.mockResolvedValue(false);

    const result = await finalizeRecording.run({
      id: "rec_1",
      mediaVerificationRetryAttempt: 1,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "processing",
        verificationPending: true,
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("finalize-recording resumable recovery", () => {
  it("retries a stored-but-unservable completion and retires its session after persistence", async () => {
    vi.clearAllMocks();
    const { deleteResumableSession, getResumableSession } =
      await import("../server/lib/resumable-session.js");
    const { resolveResumableUploadProvider } =
      await import("../server/lib/resumable-upload-provider.js");
    const completeSession = vi.fn(async () => "https://cdn.example.com/rec_1");
    vi.mocked(getResumableSession).mockResolvedValue({
      providerId: "s3",
      sessionId: "upload-example",
      meta: {
        filename: "rec_1.webm",
        objectKey: "clips/rec_1.webm",
      },
      bytesUploaded: 3,
    });
    vi.mocked(resolveResumableUploadProvider).mockResolvedValue({
      id: "s3",
      name: "S3",
      isConfigured: () => true,
      upload: vi.fn(),
      resumable: {
        startSession: vi.fn(),
        relayChunk: vi.fn(),
        completeSession,
      },
    });
    mockState.uploadState = {
      mimeType: "video/webm",
      durationMs: 1234,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasCamera: false,
    };
    mockState.selectRows = [
      [
        {
          ...mockState.existingRecording,
          status: "failed",
          failureReason:
            "Upload was stored-but-unservable: media URL timed out",
        },
      ],
      [{ status: "ready" }],
      [],
    ];
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "recording-upload-rec_1" ? mockState.uploadState : null,
    );
    mockWriteAppState.mockResolvedValue(undefined);
    mockUpdateWhere.mockImplementation(() => ({
      returning: mockUpdateReturning,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("ok", {
            status: 206,
            headers: { "content-range": "bytes 0-1/3" },
          }),
      ),
    );

    const result = await finalizeRecording.run({
      id: "rec_1",
      mimeType: "video/webm",
    });

    expect(completeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "upload-example" }),
      "rec_1.webm",
      { stableUrl: true, recordAsset: false },
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "processing",
        failureReason: null,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "rec_1",
        status: "ready",
        videoUrl: "https://cdn.example.com/rec_1",
      }),
    );
    expect(deleteResumableSession).toHaveBeenCalledWith("rec_1");
  });
});
