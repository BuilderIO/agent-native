import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

const mockRecordings = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));
const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockUserEmail = vi.hoisted(() => ({ value: null as string | null }));
const mockLoadAgentFrame = vi.hoisted(() => vi.fn());
const mockLoadScreenshotJpeg = vi.hoisted(() => vi.fn());
const mockRecommended = vi.hoisted(() => vi.fn());
const mockMediaCleanup = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockUserEmail.value,
}));

vi.mock("@agent-native/core/org", () => ({ isOrgMember: vi.fn() }));
vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: vi.fn(),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
  roleSatisfies: () => true,
}));
vi.mock("@agent-native/core/server", () => ({
  getForwardedRequestURL: (event: { url: URL | string }) => new URL(event.url),
  getSession: vi.fn(),
  signScopedAgentAccessToken: vi.fn(() => "signed"),
  // A token is good only for the clip it was minted for.
  verifyScopedAgentAccessToken: (
    token: string,
    { resourceId }: { resourceId: string },
  ) =>
    token === `tok:${resourceId}`
      ? { ok: true, agentLabel: null, viewerEmail: null }
      : { ok: false },
}));
// raw-sql-ok: a mock; no SQL is built
vi.mock("drizzle-orm", () => ({
  asc: vi.fn((column: unknown) => column),
  eq: vi.fn((column: unknown, value: unknown) => [column, value]),
  sql: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({
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
    recordings: { id: "recording.id" },
    recordingTranscripts: { recordingId: "transcript.recordingId" },
    recordingCtas: { recordingId: "cta.recordingId", createdAt: "cta.at" },
  },
}));
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  fetchS3ObjectByUrl: vi.fn(),
}));
vi.mock("../server/lib/share-password.js", () => ({
  getRecordingAccessTokenResourceId: (id: string, password: string | null) =>
    password ? `${id}:password-scoped` : `${id}:update-scoped`,
  verifySharePassword: vi.fn(() => false),
}));
vi.mock("../server/lib/agent-views.js", () => ({
  recordAgentView: vi.fn(),
}));
vi.mock("../server/lib/agent-frame-load.js", () => ({
  createAgentFrameMediaSource: () => ({
    load: vi.fn(),
    cleanup: mockMediaCleanup,
  }),
  loadAgentFrame: (...args: unknown[]) => mockLoadAgentFrame(...args),
  loadScreenshotJpeg: (...args: unknown[]) => mockLoadScreenshotJpeg(...args),
}));
vi.mock("../server/lib/agent-frame-store.js", () => ({
  clampAgentFrameAtMs: (atMs: number, durationMs: number) =>
    durationMs > 0 ? Math.min(atMs, Math.max(0, durationMs - 1)) : atMs,
  recommendedAgentFrames: (...args: unknown[]) => mockRecommended(...args),
}));

import action from "./get-recording-frames.js";

type FramesOutput = {
  recordingId: string;
  title: string;
  durationMs: number | null;
  frames: Array<{
    atMs: number;
    timestamp: string;
    label: string;
    requestedAtMs?: number;
  }>;
  recommendedFrames: Array<{ atMs: number; timestamp: string; reason: string }>;
  failures: Array<{
    atMs: number;
    failureKind: string;
    error: string;
    nextStep: string;
  }>;
  _agentImages: Array<{ data: string; mediaType: string; label: string }>;
};

type FramesFailure = {
  message: string;
  errorCode: string;
  statusCode: number;
  details: { nextStep: string; failures: unknown[] };
};

// defineAction is mocked to return its options.
const def = action as unknown as {
  run: (args: Record<string, unknown>) => Promise<FramesOutput>;
  schema: ZodType<{ recordingId: string; atMs?: number[] }>;
  description: string;
  outputSchema: unknown;
  mcpApp: unknown;
  mcpTool?: unknown;
  readOnly: boolean;
  http: unknown;
  mcpAnnotations: { readOnlyHint?: boolean };
  errors: { codes: string[] };
};

const OWNER = "owner@example.com";
const run = (args: Record<string, unknown>) => def.run(args);

function makeRecording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    title: "Demo clip",
    ownerEmail: OWNER,
    visibility: "public",
    password: null,
    archivedAt: null,
    trashedAt: null,
    expiresAt: null,
    failureCode: null,
    status: "ready",
    kind: "video",
    editsJson: "{}",
    videoUrl: "https://media.example.com/clip.webm",
    videoFormat: "webm",
    durationMs: 60_000,
    sharePasswordVersion: "initial",
    ...overrides,
  };
}

const RECOMMENDED = [0, 10_000, 20_000, 30_000, 40_000, 50_000].map(
  (atMs, i) => ({
    atMs,
    timestamp: `0:${String(atMs / 1000).padStart(2, "0")}`,
    reason: i === 1 ? "chapter: Setup" : `mark ${i}`,
  }),
);

function frameBytes(atMs: number) {
  return Uint8Array.from([0xff, 0xd8, atMs % 251, 0xff, 0xd9]);
}

async function failureOf(promise: Promise<unknown>): Promise<FramesFailure> {
  try {
    await promise;
  } catch (error) {
    return error as FramesFailure;
  }
  throw new Error("expected the call to fail");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordings.rows = [makeRecording()];
  mockUserEmail.value = null;
  mockResolveAccess.mockResolvedValue(null);
  mockRecommended.mockResolvedValue(RECOMMENDED);
  mockLoadAgentFrame.mockImplementation(
    async (_rec: unknown, atMs: number) => ({
      frame: frameBytes(atMs),
      atMs,
      moved: false,
    }),
  );
  mockLoadScreenshotJpeg.mockResolvedValue(frameBytes(0));
});

describe("get-recording-frames definition", () => {
  it("is a read-only MCP tool in the compact catalog with an output schema", () => {
    expect(def.mcpApp).toEqual({ compactCatalog: true });
    expect(def.mcpTool).toBeUndefined();
    expect(def.readOnly).toBe(true);
    expect(def.http).toEqual({ method: "GET" });
    expect(def.mcpAnnotations.readOnlyHint).toBe(true);
    expect(def.outputSchema).toBeDefined();
    expect(def.description).toContain("Clips recording (clip)");
    expect(def.description).toContain("at most 4 frames");
    expect(def.errors.codes).toContain("password_required");
  });

  it("rejects more than 4 timestamps and negative or fractional ones", () => {
    const schema = def.schema;
    expect(
      schema.safeParse({ recordingId: "rec-1", atMs: [1, 2, 3, 4] }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ recordingId: "rec-1", atMs: [1, 2, 3, 4, 5] }).success,
    ).toBe(false);
    expect(schema.safeParse({ recordingId: "rec-1", atMs: [] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ recordingId: "rec-1", atMs: [-1] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ recordingId: "rec-1", atMs: [1.5] }).success,
    ).toBe(false);
  });
});

describe("atMs shapes", () => {
  const parse = (atMs: unknown) =>
    def.schema.safeParse({ recordingId: "rec-1", atMs });

  it.each([
    [6789, [6789]],
    ["6789", [6789]],
    ["350,6789", [350, 6789]],
    [" 350 , 6789 ", [350, 6789]],
    [
      [350, 6789],
      [350, 6789],
    ],
    [
      ["350", 6789],
      [350, 6789],
    ],
    [0, [0]],
  ])("accepts %j as %j", (input, expected) => {
    const result = parse(input);
    expect(result.success).toBe(true);
    expect(result.data.atMs).toEqual(expected);
  });

  it("leaves atMs optional", () => {
    expect(def.schema.safeParse({ recordingId: "rec-1" }).success).toBe(true);
  });

  it.each([
    "abc",
    "350,abc",
    "350,,6789",
    "",
    ",",
    "-5",
    -5,
    [-5],
    ["abc"],
    [""],
    "1.5",
    "1,2,3,4,5",
    [1, 2, 3, 4, 5],
    [],
    null,
    true,
    {},
  ])("rejects %j", (input) => {
    expect(parse(input).success).toBe(false);
  });

  it("serves a numeric string through the action", async () => {
    const parsed = parse("1000,2000");
    const result = await run(parsed.data);
    expect(result.frames.map((f) => f.atMs)).toEqual([1000, 2000]);
  });
});

describe("input", () => {
  it("needs a recordingId", async () => {
    const schema = def.schema;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ recordingId: " " }).success).toBe(false);
  });
});

describe("access", () => {
  it("serves the owner a private clip", async () => {
    mockRecordings.rows = [makeRecording({ visibility: "private" })];
    mockUserEmail.value = OWNER;
    const result = await run({ recordingId: "rec-1" });
    expect(result.frames).toHaveLength(4);
  });

  it("serves a user the private clip was shared with", async () => {
    mockRecordings.rows = [makeRecording({ visibility: "private" })];
    mockUserEmail.value = "shared@example.com";
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: mockRecordings.rows[0],
    });
    const result = await run({ recordingId: "rec-1" });
    expect(result.recordingId).toBe("rec-1");
    expect(mockResolveAccess).toHaveBeenCalledWith("recording", "rec-1");
  });

  it("serves an organization member an org clip", async () => {
    mockRecordings.rows = [makeRecording({ visibility: "org" })];
    mockUserEmail.value = "teammate@example.com";
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: mockRecordings.rows[0],
    });
    expect((await run({ recordingId: "rec-1" })).frames).toHaveLength(4);
  });

  it("refuses a stranger on a private clip", async () => {
    mockRecordings.rows = [makeRecording({ visibility: "private" })];
    mockUserEmail.value = "stranger@example.com";
    const error = await failureOf(run({ recordingId: "rec-1" }));
    expect(error.errorCode).toBe("no_access");
    expect(error.details.nextStep).toContain("Share with agents");
    expect(mockLoadAgentFrame).not.toHaveBeenCalled();
  });

  it("serves a public clip to anyone", async () => {
    mockUserEmail.value = "stranger@example.com";
    expect((await run({ recordingId: "rec-1" })).frames).toHaveLength(4);
  });

  it("asks for a Share with agents link on a password clip to anyone but its owner", async () => {
    mockRecordings.rows = [makeRecording({ password: "hash" })];
    mockUserEmail.value = "stranger@example.com";
    const error = await failureOf(run({ recordingId: "rec-1" }));
    expect(error.errorCode).toBe("password_required");
    expect(error.details.nextStep).toContain("Share with agents");

    // A user the clip is shared with gets no way around the password either.
    mockRecordings.rows = [
      makeRecording({ password: "hash", visibility: "private" }),
    ];
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: mockRecordings.rows[0],
    });
    expect(await failureOf(run({ recordingId: "rec-1" }))).toMatchObject({
      errorCode: "password_required",
    });
    expect(mockLoadAgentFrame).not.toHaveBeenCalled();
  });

  it("serves a password clip to its owner", async () => {
    mockRecordings.rows = [makeRecording({ password: "hash" })];
    mockUserEmail.value = OWNER;
    expect((await run({ recordingId: "rec-1" })).frames).toHaveLength(4);
  });
});

describe("clip-level refusals", () => {
  it.each([
    ["a redaction hold", { editsJson: "{unreadable" }, "redaction_pending"],
    ["a clip still processing", { status: "processing" }, "not_ready"],
    ["a failed clip", { status: "failed" }, "recording_failed"],
    [
      "a YouTube embed",
      { videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" },
      "frames_unsupported",
    ],
    ["an expired clip", { expiresAt: "2020-01-01T00:00:00.000Z" }, "expired"],
  ])(
    "fails the call for %s before cutting any frame",
    async (_name, overrides, code) => {
      mockRecordings.rows = [makeRecording(overrides)];
      mockUserEmail.value = "stranger@example.com";
      const error = await failureOf(run({ recordingId: "rec-1" }));
      expect(error.errorCode).toBe(code);
      expect(error.details.nextStep).toEqual(expect.any(String));
      expect(error.message).toContain(error.details.nextStep);
      expect(mockLoadAgentFrame).not.toHaveBeenCalled();
      expect(mockRecommended).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["trashed", { trashedAt: "2026-01-01T00:00:00.000Z" }],
    ["archived", { archivedAt: "2026-01-01T00:00:00.000Z" }],
  ])("tells the owner a %s clip is unavailable", async (_name, overrides) => {
    mockRecordings.rows = [makeRecording(overrides)];
    mockUserEmail.value = OWNER;
    mockResolveAccess.mockResolvedValue({
      role: "owner",
      resource: mockRecordings.rows[0],
    });
    const error = await failureOf(run({ recordingId: "rec-1" }));
    expect(error.errorCode).toBe("unavailable");
    expect(mockLoadAgentFrame).not.toHaveBeenCalled();
  });

  it("does not reveal a trashed clip to a stranger", async () => {
    mockRecordings.rows = [
      makeRecording({ trashedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    mockUserEmail.value = "stranger@example.com";
    expect(await failureOf(run({ recordingId: "rec-1" }))).toMatchObject({
      errorCode: "no_access",
    });
  });

  it("lets the owner see frames while redactions are pending", async () => {
    mockRecordings.rows = [makeRecording({ editsJson: "{unreadable" })];
    mockUserEmail.value = OWNER;
    expect((await run({ recordingId: "rec-1" })).frames).toHaveLength(4);
  });
});

describe("frames", () => {
  it("asks for atMs when the clip has no recommended frames", async () => {
    mockRecommended.mockResolvedValue([]);
    const error = await failureOf(run({ recordingId: "rec-1" }));
    expect(error.errorCode).toBe("invalid_input");
    expect(error.details.nextStep).toContain("atMs");
  });

  it("takes and reports atMs on the edited timeline of a trimmed clip", async () => {
    // The owner cut 10s-20s, so 15s as played is 25s of the original.
    mockRecordings.rows = [
      makeRecording({
        editsJson: JSON.stringify({
          trims: [{ startMs: 10_000, endMs: 20_000, excluded: true }],
        }),
      }),
    ];
    const result = await run({ recordingId: "rec-1", atMs: [15_000] });
    expect(mockLoadAgentFrame).toHaveBeenCalledWith(
      expect.anything(),
      25_000,
      expect.anything(),
    );
    expect(result.frames.map((f) => f.atMs)).toEqual([15_000]);
    expect(result.durationMs).toBe(50_000);
  });

  it("returns the first 4 recommended frames and lists all of them", async () => {
    const result = await run({ recordingId: "rec-1" });
    expect(result.frames.map((f) => f.atMs)).toEqual([
      0, 10_000, 20_000, 30_000,
    ]);
    expect(result._agentImages).toHaveLength(4);
    expect(result.recommendedFrames).toEqual(RECOMMENDED);
    expect(result.recommendedFrames).toHaveLength(6);
    expect(result.failures).toEqual([]);
    expect(result.title).toBe("Demo clip");
    expect(result.durationMs).toBe(60_000);
  });

  it("returns images as base64 JPEG data, never urls", async () => {
    const result = await run({ recordingId: "rec-1", atMs: [1000, 2000] });
    expect(result._agentImages).toHaveLength(2);
    result._agentImages.forEach((image, i: number) => {
      expect(Object.keys(image).sort()).toEqual(["data", "label", "mediaType"]);
      expect(image.mediaType).toBe("image/jpeg");
      expect(image).not.toHaveProperty("url");
      expect(Buffer.from(image.data, "base64")).toEqual(
        Buffer.from(frameBytes([1000, 2000][i])),
      );
      expect(image.label).toBe(result.frames[i].label);
    });
    expect(JSON.stringify(result.frames)).not.toContain("http");
  });

  it("serves the requested timestamps in order, clamped to the duration, once each", async () => {
    const result = await run({
      recordingId: "rec-1",
      atMs: [5000, 99_999, 5000, 70_000],
    });
    expect(result.frames.map((f) => f.atMs)).toEqual([5000, 59_999]);
    expect(result.frames[1].requestedAtMs).toBe(99_999);
  });

  it("labels a frame with the timestamp it was actually cut at", async () => {
    mockLoadAgentFrame.mockImplementation(async (_rec: unknown, atMs: number) =>
      atMs === 59_000
        ? { frame: frameBytes(58_999), atMs: 58_999, moved: true }
        : { frame: frameBytes(atMs), atMs, moved: false },
    );
    const result = await run({ recordingId: "rec-1", atMs: [59_000] });
    expect(result.frames).toEqual([
      expect.objectContaining({ atMs: 58_999, requestedAtMs: 59_000 }),
    ]);
    expect(result._agentImages[0].label).toContain("58999");
    expect(result._agentImages[0].label).not.toContain("59000");
  });

  it("returns the frames that worked and a typed entry for each that did not", async () => {
    mockLoadAgentFrame.mockImplementation(
      async (_rec: unknown, atMs: number) => {
        if (atMs === 2000) {
          const { VideoFrameExtractionError } =
            await import("../server/lib/video-frame.js");
          throw new VideoFrameExtractionError(
            "NO_FRAME_AT_TIMESTAMP",
            "No frame was available at that timestamp.",
          );
        }
        return { frame: frameBytes(atMs), atMs, moved: false };
      },
    );
    const result = await run({
      recordingId: "rec-1",
      atMs: [1000, 2000, 3000],
    });
    expect(result.frames.map((f) => f.atMs)).toEqual([1000, 3000]);
    expect(result._agentImages).toHaveLength(2);
    expect(result.failures).toEqual([
      {
        atMs: 2000,
        failureKind: "processing",
        error: "No frame was available at that timestamp.",
        nextStep: expect.stringContaining("different timestamp"),
      },
    ]);
  });

  it("fails the call when no frame could be produced", async () => {
    const { RecordingMediaFetchError } =
      await import("../server/lib/public-agent-context.js");
    mockLoadAgentFrame.mockRejectedValue(
      new RecordingMediaFetchError("gone", 404),
    );
    const error = await failureOf(
      run({ recordingId: "rec-1", atMs: [1000, 2000] }),
    );
    expect(error.errorCode).toBe("media_unavailable");
    expect(error.details.failures).toHaveLength(2);
    expect(mockMediaCleanup).toHaveBeenCalled();
  });

  it.each([
    ["a missing object", 404, "media_unavailable"],
    ["denied storage", 403, "media_unavailable"],
    ["a media timeout", 504, "frame_extraction_failed"],
  ])(
    "fails with the route's status when every frame hits %s",
    async (_n, status, code) => {
      const { RecordingMediaFetchError } =
        await import("../server/lib/public-agent-context.js");
      const { frameFailureStatus } =
        await import("../server/lib/agent-frame-request.js");
      const media = new RecordingMediaFetchError("storage said no", status);
      mockLoadAgentFrame.mockRejectedValue(media);
      const error = await failureOf(
        run({ recordingId: "rec-1", atMs: [1000, 2000] }),
      );
      expect(error.errorCode).toBe(code);
      expect(frameFailureStatus(media)).toBe(status);
      expect(error.statusCode).toBe(frameFailureStatus(media));
      expect(JSON.stringify(error.details)).not.toContain("statusCode");
    },
  );

  it("fails an unsupported video with its 422", async () => {
    const { VideoFrameExtractionError } =
      await import("../server/lib/video-frame.js");
    mockLoadAgentFrame.mockRejectedValue(
      new VideoFrameExtractionError("NO_VIDEO_TRACK", "no video track"),
    );
    const error = await failureOf(run({ recordingId: "rec-1", atMs: [1000] }));
    expect(error.errorCode).toBe("frames_unsupported");
    expect(error.statusCode).toBe(422);
  });

  it("fails rather than returning an oversize image", async () => {
    mockLoadAgentFrame.mockResolvedValue({
      frame: new Uint8Array(1_600_000),
      atMs: 1000,
      moved: false,
    });
    const error = await failureOf(run({ recordingId: "rec-1", atMs: [1000] }));
    expect(error.errorCode).toBe("frames_unsupported");
  });

  it("returns a screenshot's picture as its one frame", async () => {
    mockRecordings.rows = [makeRecording({ kind: "image", durationMs: null })];
    const result = await run({ recordingId: "rec-1" });
    expect(result.frames).toHaveLength(1);
    expect(result.recommendedFrames).toEqual([]);
    expect(result._agentImages).toEqual([
      {
        data: Buffer.from(frameBytes(0)).toString("base64"),
        mediaType: "image/jpeg",
        label: "Screenshot",
      },
    ]);
    expect(mockLoadAgentFrame).not.toHaveBeenCalled();
  });

  it("fails when a screenshot cannot be loaded", async () => {
    mockRecordings.rows = [makeRecording({ kind: "image" })];
    const { RecordingMediaFetchError } =
      await import("../server/lib/public-agent-context.js");
    mockLoadScreenshotJpeg.mockRejectedValue(
      new RecordingMediaFetchError("Screenshot media is missing.", 404),
    );
    expect(await failureOf(run({ recordingId: "rec-1" }))).toMatchObject({
      errorCode: "media_unavailable",
    });
  });
});
