import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAppStateGet = vi.hoisted(() => vi.fn());
const mockSsrfSafeFetch = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockSignShortLivedToken = vi.hoisted(() => vi.fn());
const mockVerifyShortLivedToken = vi.hoisted(() => vi.fn());
const mockRecordings = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: (...args: unknown[]) => mockAppStateGet(...args),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  signShortLivedToken: (...args: unknown[]) => mockSignShortLivedToken(...args),
  verifyShortLivedToken: (...args: unknown[]) =>
    mockVerifyShortLivedToken(...args),
}));

vi.mock("drizzle-orm", () => ({
  asc: vi.fn((column: unknown) => column),
  eq: vi.fn((column: unknown, value: unknown) => [column, value]),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mockRecordings.rows,
          orderBy: async () => [],
        }),
      }),
    }),
  }),
  schema: {
    recordings: {
      id: "recording.id",
    },
    recordingTranscripts: {
      recordingId: "transcript.recordingId",
    },
    recordingCtas: {
      recordingId: "cta.recordingId",
      createdAt: "cta.createdAt",
    },
  },
}));

vi.mock("./share-password.js", () => ({
  verifySharePassword: vi.fn(() => false),
}));

import {
  buildPublicAgentContext,
  loadPublicAgentAccess,
  loadRecordingMediaBytes,
  RecordingMediaFetchError,
} from "./public-agent-context";

const originalMaxMediaBytes = process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES;

function makeRecording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    title: "Clip",
    description: "",
    ownerEmail: "owner@example.com",
    visibility: "public",
    password: null,
    archivedAt: null,
    trashedAt: null,
    expiresAt: null,
    videoUrl: "https://media.example.com/clip.webm",
    videoFormat: "webm",
    videoSizeBytes: null,
    durationMs: 10_000,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function streamFrom(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("public agent context access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordings.rows = [];
    mockGetSession.mockResolvedValue(null);
    mockSignShortLivedToken.mockReturnValue("signed-token");
    mockVerifyShortLivedToken.mockReturnValue({ ok: false });
  });

  it("mints a short-lived API token for owners sharing password-protected public clips", async () => {
    mockRecordings.rows = [
      makeRecording({
        password: "encrypted-password",
      }),
    ];
    mockGetSession.mockResolvedValue({ email: "owner@example.com" });

    const result = await loadPublicAgentAccess({} as any, "rec-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.access.apiToken).toBe("signed-token");
    }
    expect(mockSignShortLivedToken).toHaveBeenCalledWith({
      resourceId: "rec-1",
    });
  });
});

describe("loadRecordingMediaBytes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES = "4";
  });

  afterEach(() => {
    if (originalMaxMediaBytes === undefined) {
      delete process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES;
    } else {
      process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES = originalMaxMediaBytes;
    }
  });

  it("rejects oversized local blob payloads from their estimated decoded length", async () => {
    mockAppStateGet.mockResolvedValue({
      data: Buffer.from("12345").toString("base64"),
      mimeType: "video/webm",
    });

    await expect(
      loadRecordingMediaBytes(
        makeRecording({
          videoUrl: "/api/video/rec-1",
        }) as any,
      ),
    ).rejects.toThrow(/too large/i);
  });

  it("normalizes data-url local blobs before decoding", async () => {
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES = "10";
    mockAppStateGet.mockResolvedValue({
      data: `data:video/webm;base64,${Buffer.from("hi").toString("base64")}`,
      mimeType: "application/octet-stream",
    });

    const result = await loadRecordingMediaBytes(
      makeRecording({
        videoUrl: "/api/video/rec-1",
      }) as any,
    );

    expect(Buffer.from(result.bytes).toString("utf8")).toBe("hi");
    expect(result.mimeType).toBe("video/webm");
  });

  it("stops streaming remote media once the configured byte limit is exceeded", async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(streamFrom([Buffer.from("12"), Buffer.from("345")]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    );

    await expect(
      loadRecordingMediaBytes(makeRecording({ videoFormat: "mp4" }) as any),
    ).rejects.toThrow(/too large/i);
  });

  it("wraps remote media fetch exceptions as fetch failures", async () => {
    mockSsrfSafeFetch.mockRejectedValue(new Error("fetch failed"));

    await expect(
      loadRecordingMediaBytes(makeRecording({ videoFormat: "mp4" }) as any),
    ).rejects.toMatchObject({
      name: "RecordingMediaFetchError",
      statusCode: 502,
      message: "Recording media could not be fetched.",
    });
  });

  it("wraps non-ok remote media responses with the upstream status", async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response("", { status: 403, statusText: "Forbidden" }),
    );

    const promise = loadRecordingMediaBytes(
      makeRecording({ videoFormat: "mp4" }) as any,
    );
    await expect(promise).rejects.toBeInstanceOf(RecordingMediaFetchError);
    await expect(promise).rejects.toMatchObject({
      statusCode: 403,
      message: "Recording media fetch failed: HTTP 403 Forbidden",
    });
  });

  it("does not fetch bytes for legacy Loom embed imports", async () => {
    await expect(
      loadRecordingMediaBytes(
        makeRecording({
          sourceAppName: "Loom",
          sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
          videoUrl: "/api/video/rec-1",
          videoFormat: "mp4",
        }) as any,
      ),
    ).rejects.toThrow(/legacy Loom embed/i);
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });
});

describe("buildPublicAgentContext", () => {
  it("omits frame APIs and recommended frames for legacy Loom embed imports", () => {
    const context = buildPublicAgentContext({
      event: {
        url: new URL(
          "https://clips.example.com/api/agent-context.json?id=rec-1",
        ),
        req: {
          headers: new Headers(),
        },
      } as any,
      access: {
        recording: makeRecording({
          sourceAppName: "Loom",
          sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
          videoUrl: "/api/video/rec-1",
          videoFormat: "mp4",
        }) as any,
        viewerIsOwner: false,
        apiToken: "signed-token",
      },
      transcript: null,
      agentSegments: [],
      chapters: [{ startMs: 1000, title: "Chapter" }],
      ctas: [],
    });

    expect(context.clip.sourceProvider).toBe("loom");
    expect(context.apis).not.toHaveProperty("frame");
    expect(context.recommendedFrames).toEqual([]);
    expect(context.instructions.join(" ")).toMatch(
      /frame extraction is not available/i,
    );
  });

  it("keeps frame APIs for reuploaded Loom source recordings", () => {
    const context = buildPublicAgentContext({
      event: {
        url: new URL(
          "https://clips.example.com/api/agent-context.json?id=rec-1",
        ),
        req: {
          headers: new Headers(),
        },
      } as any,
      access: {
        recording: makeRecording({
          sourceAppName: "Loom",
          sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
          videoUrl: "https://cdn.example.com/reuploaded.mp4",
          videoFormat: "mp4",
          videoSizeBytes: 1024,
        }) as any,
        viewerIsOwner: false,
        apiToken: "signed-token",
      },
      transcript: null,
      agentSegments: [],
      chapters: [{ startMs: 1000, title: "Chapter" }],
      ctas: [],
    });

    expect(context.clip.sourceProvider).toBe("loom");
    expect(context.apis).toHaveProperty("frame");
    expect(context.recommendedFrames.length).toBeGreaterThan(0);
  });

  it("exposes compact redacted browser diagnostics in public agent context", () => {
    const context = buildPublicAgentContext({
      event: {
        url: new URL(
          "https://clips.example.com/api/agent-context.json?id=rec-1",
        ),
        req: {
          headers: new Headers(),
        },
      } as any,
      access: {
        recording: makeRecording() as any,
        viewerIsOwner: false,
        apiToken: null,
      },
      transcript: null,
      agentSegments: [],
      chapters: [],
      ctas: [],
      browserDiagnostics: {
        pageUrl: "https://clips.example.com/record",
        userAgent: "Test",
        startedAt: "2026-06-22T10:00:00.000Z",
        endedAt: "2026-06-22T10:01:00.000Z",
        summary: {
          consoleCount: 2,
          consoleErrorCount: 1,
          consoleWarnCount: 1,
          networkCount: 2,
          networkFailureCount: 1,
          capturedAt: "2026-06-22T10:01:00.000Z",
        },
        consoleLogs: [
          {
            timestampMs: 1,
            elapsedMs: 1,
            level: "log",
            message: "Started",
          },
          {
            timestampMs: 2,
            elapsedMs: 2,
            level: "error",
            message: "Failed without token=<redacted>",
          },
        ],
        networkRequests: [
          {
            timestampMs: 3,
            elapsedMs: 3,
            type: "fetch",
            method: "GET",
            url: "https://api.example.com/fail?token=<redacted>",
            status: 500,
            durationMs: 120,
          },
          {
            timestampMs: 4,
            elapsedMs: 4,
            type: "xhr",
            method: "POST",
            url: "/ok",
            status: 200,
            durationMs: 40,
          },
        ],
      },
    });

    expect(context.browserDiagnostics?.summary.networkFailureCount).toBe(1);
    expect(context.browserDiagnostics?.consoleIssues).toEqual([
      {
        timestampMs: 2,
        level: "error",
        message: "Failed without token=<redacted>",
      },
    ]);
    expect(context.browserDiagnostics?.failedNetworkRequests).toEqual([
      {
        timestampMs: 3,
        type: "fetch",
        method: "GET",
        status: 500,
        error: null,
        durationMs: 120,
      },
    ]);
    expect(context.browserDiagnostics).not.toHaveProperty("pageUrl");
    expect(
      context.browserDiagnostics?.failedNetworkRequests[0],
    ).not.toHaveProperty("url");
  });
});
