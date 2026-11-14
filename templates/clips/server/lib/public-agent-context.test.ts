import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRm = vi.hoisted(() => vi.fn());
const mockStatfs = vi.hoisted(() => vi.fn());
const mockOpen = vi.hoisted(() => vi.fn());
const mockAppStateGet = vi.hoisted(() => vi.fn());
const mockSsrfSafeFetch = vi.hoisted(() => vi.fn());
const mockFetchS3ObjectByUrl = vi.hoisted(() => vi.fn());
const mockOpenS3Recording = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockSignScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const mockRecordings = vi.hoisted(() => ({ rows: [] as any[] }));
const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockIsOrgMember = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  mockRm.mockImplementation(actual.rm);
  mockStatfs.mockImplementation(actual.statfs);
  mockOpen.mockImplementation(actual.open);
  return { ...actual, rm: mockRm, statfs: mockStatfs, open: mockOpen };
});

vi.mock("@agent-native/core/org", () => ({
  isOrgMember: mockIsOrgMember,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mockResolveAccess,
  roleSatisfies: (actual: string, minimum: string) => {
    const rank = ["viewer", "commenter", "editor", "admin", "owner"];
    return rank.indexOf(actual) >= rank.indexOf(minimum);
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: (...args: unknown[]) => mockAppStateGet(...args),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));
vi.mock("./s3-upload-provider.js", () => ({
  fetchS3ObjectByUrl: (...args: unknown[]) => mockFetchS3ObjectByUrl(...args),
  openS3Recording: (...args: unknown[]) => mockOpenS3Recording(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  getForwardedRequestURL: (event: { url: URL | string }) => new URL(event.url),
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  signScopedAgentAccessToken: (...args: unknown[]) =>
    mockSignScopedAgentAccessToken(...args),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mockVerifyScopedAgentAccessToken(...args),
}));

vi.mock("drizzle-orm", () => ({
  asc: vi.fn((column: unknown) => column),
  eq: vi.fn((column: unknown, value: unknown) => [column, value]),
  sql: vi.fn(),
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

const mockRecordAgentView = vi.hoisted(() => vi.fn());

vi.mock("./agent-views.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-views.js")>()),
  recordAgentView: (...args: unknown[]) => mockRecordAgentView(...args),
}));

vi.mock("./share-password.js", () => ({
  getRecordingAccessTokenResourceId: vi.fn(
    (
      id: string,
      password: string | null,
      _version: string,
      visibility: string,
    ) => {
      const base = password ? `${id}:password-scoped` : `${id}:update-scoped`;
      return visibility === "public"
        ? base
        : `${base}:visibility:${visibility}`;
    },
  ),
  verifySharePassword: vi.fn(() => false),
}));

import {
  describeFrameFailure,
  frameFailureStatus,
} from "./agent-frame-request.js";
import {
  buildPublicAgentContext,
  canReadAppActivityEvents,
  CLIPS_AGENT_ACCESS_TTL_SECONDS,
  describeAgentAccessFailure,
  loadPublicAgentAccess,
  resolvePublicAgentAccess,
  loadRecordingMediaFile,
  loadRecordingMediaBytes,
  RecordingMediaFetchError,
  transcriptStatusInstructions,
  type PublicAgentRecording,
} from "./public-agent-context";
import { verifySharePassword } from "./share-password.js";
import { planFrameSheet } from "./video-frame-sheet.js";
import {
  extractJpegFrameFromFile,
  extractJpegFrameSheetFromFile,
  probeFrameSheetFpsFromFile,
} from "./video-frame.js";
import { resolveFfmpegCommand } from "./video-remux.js";

const originalMaxMediaBytes = process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES;
const originalMaxMediaFileBytes =
  process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES;

type RecordingFixture = Partial<
  Omit<PublicAgentRecording, "videoSizeBytes">
> & {
  videoSizeBytes?: number | null;
};

function makeRecording(overrides: RecordingFixture = {}): RecordingFixture {
  return {
    id: "rec-1",
    title: "Clip",
    description: "",
    ownerEmail: "owner@example.com",
    visibility: "public" as const,
    password: null,
    archivedAt: null,
    trashedAt: null,
    expiresAt: null,
    videoUrl: "https://media.example.com/clip.webm",
    videoFormat: "webm" as const,
    videoSizeBytes: null,
    durationMs: 10_000,
    updatedAt: "2026-01-01T00:00:00.000Z",
    sharePasswordVersion: "initial",
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

function streamThatFailsAfterChunk() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("partial"));
      controller.error(new Error("connection reset"));
    },
  });
}

describe("public agent context access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordings.rows = [];
    mockGetSession.mockResolvedValue(null);
    mockSignScopedAgentAccessToken.mockReturnValue("signed-token");
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
  });

  it("mints a short-lived API token for owners sharing password-protected public clips", async () => {
    mockRecordings.rows = [
      makeRecording({
        password: randomUUID(),
      }),
    ];
    mockGetSession.mockResolvedValue({ email: "owner@example.com" });

    const result = await loadPublicAgentAccess({} as any, "rec-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.access.apiToken).toBe("signed-token");
    }
    expect(mockSignScopedAgentAccessToken).toHaveBeenCalledWith({
      resourceKind: "clip-agent-context",
      resourceId: "rec-1:password-scoped",
      ttlSeconds: CLIPS_AGENT_ACCESS_TTL_SECONDS,
    });
  });

  it.each(["private", "org"] as const)(
    "rejects a real %s viewer grant after the password becomes public",
    async (visibility) => {
      const storedPassword = randomUUID();
      const core = await vi.importActual<
        typeof import("@agent-native/core/server")
      >("@agent-native/core/server");
      const passwords = await vi.importActual<
        typeof import("./share-password.js")
      >("./share-password.js");
      const mockedPasswords = await import("./share-password.js");
      const token = core.signScopedAgentAccessToken({
        resourceKind: "clip-agent-context",
        resourceId: passwords.getRecordingAccessTokenResourceId(
          "rec-1",
          storedPassword,
          "initial",
          visibility,
        ),
      });
      vi.mocked(mockedPasswords.getRecordingAccessTokenResourceId)
        .mockImplementationOnce(passwords.getRecordingAccessTokenResourceId)
        .mockImplementationOnce(passwords.getRecordingAccessTokenResourceId);
      mockVerifyScopedAgentAccessToken.mockImplementation(
        core.verifyScopedAgentAccessToken,
      );
      mockRecordings.rows = [
        makeRecording({ visibility, password: storedPassword }),
      ];
      expect(
        (
          await loadPublicAgentAccess(
            {} as Parameters<typeof loadPublicAgentAccess>[0],
            "rec-1",
            { token },
          )
        ).ok,
      ).toBe(true);
      mockRecordings.rows = [
        makeRecording({ visibility: "public", password: storedPassword }),
      ];
      expect(
        await loadPublicAgentAccess(
          {} as Parameters<typeof loadPublicAgentAccess>[0],
          "rec-1",
          { token },
        ),
      ).toMatchObject({
        ok: false,
        failure: { status: 401, body: { passwordRequired: true } },
      });
    },
  );

  it("does not accept an agent token scoped before a password was added", async () => {
    mockRecordings.rows = [
      makeRecording({
        visibility: "private",
        password: randomUUID(),
      }),
    ];

    const result = await loadPublicAgentAccess({} as any, "rec-1", {
      token: "old-agent-token",
    });

    expect(result).toMatchObject({ ok: false, failure: { status: 404 } });
    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith(
      "old-agent-token",
      {
        resourceKind: "clip-agent-context",
        resourceId: "rec-1:password-scoped:visibility:private",
      },
    );
  });

  it("allows a scoped agent token to read private clips without making them public", async () => {
    mockRecordings.rows = [
      makeRecording({
        visibility: "private",
      }),
    ];
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });

    const result = await loadPublicAgentAccess({} as any, "rec-1", {
      token: "agent-token",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.access.apiToken).toBe("agent-token");
      expect(result.access.recording.visibility).toBe("private");
    }
    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith(
      "agent-token",
      {
        resourceKind: "clip-agent-context",
        resourceId: "rec-1:update-scoped:visibility:private",
      },
    );
  });

  it("lets a Share with agents link from an editor read app activity events but never a share password", async () => {
    mockRecordings.rows = [makeRecording({ password: randomUUID() })];

    vi.mocked(verifySharePassword).mockReturnValueOnce(true);
    const viaPassword = await loadPublicAgentAccess({} as any, "rec-1", {
      password: "letmein", // ggignore: fake share password for a mocked check
    });
    expect(viaPassword).toMatchObject({
      ok: true,
      access: { apiToken: "signed-token", agentLinkCreatorEmail: null },
    });
    expect(
      viaPassword.ok && (await canReadAppActivityEvents(viaPassword.access)),
    ).toBe(false);

    mockVerifyScopedAgentAccessToken.mockReturnValueOnce({ ok: true });
    const replayedPasswordToken = await loadPublicAgentAccess(
      {} as any,
      "rec-1",
      { token: "signed-token" },
    );
    expect(
      replayedPasswordToken.ok &&
        (await canReadAppActivityEvents(replayedPasswordToken.access)),
    ).toBe(false);
    expect(mockResolveAccess).not.toHaveBeenCalled();

    mockVerifyScopedAgentAccessToken.mockReturnValueOnce({
      ok: true,
      viewerEmail: "editor@example.com",
    });
    const fromEditor = await loadPublicAgentAccess({} as any, "rec-1", {
      token: "agent-link-token",
    });
    mockResolveAccess.mockResolvedValueOnce({ role: "editor" });
    expect(
      fromEditor.ok && (await canReadAppActivityEvents(fromEditor.access)),
    ).toBe(true);
    expect(mockResolveAccess).toHaveBeenLastCalledWith(
      "recording",
      "rec-1",
      { userEmail: "editor@example.com" },
      { skipResourceBody: true },
    );

    mockVerifyScopedAgentAccessToken.mockReturnValueOnce({
      ok: true,
      viewerEmail: "viewer@example.com",
    });
    const fromViewer = await loadPublicAgentAccess({} as any, "rec-1", {
      token: "viewer-link-token",
    });
    mockResolveAccess.mockResolvedValueOnce({ role: "viewer" });
    expect(
      fromViewer.ok && (await canReadAppActivityEvents(fromViewer.access)),
    ).toBe(false);
  });

  it("counts an org share for an agent link creator only while they are in that org", async () => {
    mockRecordings.rows = [makeRecording({ orgId: "org-1" })];
    mockVerifyScopedAgentAccessToken.mockReturnValue({
      ok: true,
      viewerEmail: "teammate@example.com",
    });
    const loaded = await loadPublicAgentAccess({} as any, "rec-1", {
      token: "agent-link-token",
    });
    if (!loaded.ok) throw new Error("expected the agent link to load");
    mockResolveAccess.mockResolvedValue({ role: "editor" });

    mockIsOrgMember.mockResolvedValueOnce(true);
    expect(await canReadAppActivityEvents(loaded.access)).toBe(true);
    expect(mockResolveAccess).toHaveBeenLastCalledWith(
      "recording",
      "rec-1",
      { userEmail: "teammate@example.com", orgId: "org-1" },
      { skipResourceBody: true },
    );

    mockIsOrgMember.mockResolvedValueOnce(false);
    await canReadAppActivityEvents(loaded.access);
    expect(mockResolveAccess).toHaveBeenLastCalledWith(
      "recording",
      "rec-1",
      { userEmail: "teammate@example.com" },
      { skipResourceBody: true },
    );
  });

  describe.each([
    "not-a-date",
    "2030-02-30T12:00:00Z",
    "12:30:00",
    "123",
    "2030-01-01T00:00:00+23:00",
    "2030-01-01T00:00:00.1234567Z",
    "2000-01-01T00:00:00Z",
  ])("agent reads with unavailable expiry %s", (expiresAt) => {
    it.each([
      { email: null, owner: false },
      { email: "viewer@example.com", owner: false },
      { email: " OWNER@EXAMPLE.COM ", owner: true },
    ])("preserves owner access only for $email", async ({ email, owner }) => {
      mockRecordings.rows = [makeRecording({ expiresAt })];
      mockGetSession.mockResolvedValue(email ? { email } : null);
      const result = await loadPublicAgentAccess(
        {} as Parameters<typeof loadPublicAgentAccess>[0],
        "rec-1",
      );
      if (owner) {
        expect(result).toMatchObject({
          ok: true,
          access: {
            viewerIsOwner: true,
            recording: { id: "rec-1", expiresAt },
          },
        });
      } else {
        expect(result).toMatchObject({ ok: false, failure: { status: 410 } });
      }
      expect(mockSignScopedAgentAccessToken).not.toHaveBeenCalled();
      expect(mockRecordAgentView).not.toHaveBeenCalled();
    });
  });

  it("keeps private clips hidden from callers without a scoped agent token", async () => {
    mockRecordings.rows = [
      makeRecording({
        visibility: "private",
      }),
    ];

    const result = await loadPublicAgentAccess({} as any, "rec-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.status).toBe(404);
    }
  });
});

describe("agent view recording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordings.rows = [];
    mockGetSession.mockResolvedValue(null);
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
  });

  it("records a non-owner read with the clip owner and whether a scoped link was used", async () => {
    mockRecordings.rows = [makeRecording({ visibility: "private" })];
    mockVerifyScopedAgentAccessToken.mockReturnValue({
      ok: true,
      agentLabel: "Fusion",
    });

    await loadPublicAgentAccess({} as any, "rec-1", { token: "agent-token" });

    expect(mockRecordAgentView).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "rec-1",
      {
        agentLabel: "Fusion",
        ownerEmail: "owner@example.com",
        viaScopedLink: true,
      },
    );
  });

  it("marks a tokenless public read as not scoped", async () => {
    mockRecordings.rows = [makeRecording()];

    await loadPublicAgentAccess({} as any, "rec-1");

    expect(mockRecordAgentView.mock.calls[0][2]).toEqual({
      agentLabel: null,
      ownerEmail: "owner@example.com",
      viaScopedLink: false,
    });
  });

  it("does not record the owner's own reads", async () => {
    mockRecordings.rows = [makeRecording()];
    mockGetSession.mockResolvedValue({ email: "owner@example.com" });

    await loadPublicAgentAccess({} as any, "rec-1");

    expect(mockRecordAgentView).not.toHaveBeenCalled();
  });
});

describe("resolvePublicAgentAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordings.rows = [];
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
  });

  it("takes the viewer's email instead of a request, owner included", async () => {
    mockRecordings.rows = [makeRecording({ visibility: "private" })];

    const stranger = await resolvePublicAgentAccess("rec-1", {
      viewerEmail: "stranger@example.com",
    });
    const owner = await resolvePublicAgentAccess("rec-1", {
      viewerEmail: "OWNER@example.com",
    });

    expect(stranger).toMatchObject({ ok: false, failure: { status: 404 } });
    expect(owner).toMatchObject({ ok: true, access: { viewerIsOwner: true } });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("reports a non-owner read through recordView, and none without one", async () => {
    mockRecordings.rows = [makeRecording()];
    const recordView = vi.fn(async () => {});

    await resolvePublicAgentAccess("rec-1", { recordView });
    await resolvePublicAgentAccess("rec-1");

    expect(recordView).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "rec-1" }),
      {
        agentLabel: null,
        ownerEmail: "owner@example.com",
        viaScopedLink: false,
      },
    );
    expect(mockRecordAgentView).not.toHaveBeenCalled();
  });
});

describe("describeAgentAccessFailure", () => {
  it("explains that a missing private share link needs agent access without exposing clip state", () => {
    const failure = describeAgentAccessFailure({
      status: 404,
      body: { error: "Not found" },
    });

    expect(failure).toEqual({
      status: 404,
      body: {
        failureKind: "access",
        error: "This clip is unavailable from this link.",
        nextStep:
          "If this clip is private or password protected, ask the owner to open the Clips Share menu, choose Share with agents, and send the generated link.",
      },
    });
  });

  it("explains password, expired-link, and malformed-URL failures", () => {
    expect(
      describeAgentAccessFailure({
        status: 401,
        body: { error: "Password required" },
      }).body,
    ).toMatchObject({
      failureKind: "access",
      error: "This clip requires additional share access.",
      nextStep: expect.stringContaining("Share with agents"),
    });
    expect(
      describeAgentAccessFailure({
        status: 410,
        body: { error: "Expired" },
      }).body,
    ).toMatchObject({
      failureKind: "expired",
      error: "This clip share link has expired.",
      nextStep: expect.stringContaining("extend or remove the clip's expiry"),
    });
    expect(
      describeAgentAccessFailure({
        status: 400,
        body: { error: "id is required" },
      }).body,
    ).toMatchObject({
      failureKind: "request",
      error: "The clip id is missing.",
      nextStep: expect.stringContaining("agent_access"),
    });
  });
});

describe("transcriptStatusInstructions", () => {
  const transcript = (segmentsJson: string | null) =>
    ({
      status: "ready",
      failureReason: null,
      segmentsJson,
    }) as unknown as Parameters<typeof transcriptStatusInstructions>[0];

  it("tells agents when saved lines can't be read, so they don't report none", () => {
    expect(transcriptStatusInstructions(transcript("[{"))).toEqual([
      expect.stringContaining("couldn't be read, not that the clip has none"),
    ]);
  });

  it.each(["[]", null])(
    "adds nothing for a ready transcript whose lines read (%s)",
    (segmentsJson) => {
      expect(transcriptStatusInstructions(transcript(segmentsJson))).toEqual(
        [],
      );
    },
  );
});

const YOUTUBE_RECORDING = {
  sourceAppName: "YouTube",
  sourceWindowTitle: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  videoUrl: "https://www.youtube.com/embed/jNQXAC9IVRw",
  videoFormat: "mp4",
} satisfies Partial<PublicAgentRecording>;

describe("loadRecordingMediaBytes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES = "4";
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES = "6";
  });

  afterEach(() => {
    if (originalMaxMediaBytes === undefined) {
      delete process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES;
    } else {
      process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES = originalMaxMediaBytes;
    }
    if (originalMaxMediaFileBytes === undefined) {
      delete process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES;
    } else {
      process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES =
        originalMaxMediaFileBytes;
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

  it("loads hosted recording bytes through the recording-scoped signed reader", async () => {
    mockFetchS3ObjectByUrl.mockResolvedValue(
      new Response("abc", {
        status: 200,
        headers: { "content-type": "video/webm" },
      }),
    );

    const result = await loadRecordingMediaBytes(
      makeRecording({ storageMode: "hosted" }) as any,
    );

    expect(Buffer.from(result.bytes).toString("utf8")).toBe("abc");
    expect(mockFetchS3ObjectByUrl).toHaveBeenCalledWith(
      "https://media.example.com/clip.webm",
      expect.objectContaining({
        recordingId: "rec-1",
        storageMode: "hosted",
      }),
    );
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it.each(["mp4-fast", "mp4-tail", "webm"])(
    "matches a full-file timestamp oracle for a >512 MiB %s object",
    async (format) => {
      const dir = await mkdtemp(join(tmpdir(), "clips-range-oracle-"));
      try {
        delete process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES;
        const isMp4 = format.startsWith("mp4");
        const source = join(dir, isMp4 ? "source.mp4" : "source.webm");
        execFileSync(resolveFfmpegCommand(), [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=64x64:rate=4",
          "-t",
          "4",
          ...(isMp4
            ? format === "mp4-fast"
              ? ["-movflags", "+faststart"]
              : []
            : ["-c:v", "libvpx"]),
          "-y",
          source,
        ]);
        const original = await readFile(source);
        const logicalSize = 513 * 1024 * 1024;
        const sparse = join(dir, "large-media");
        const file = await open(sparse, "w+");
        try {
          let split = original.length;
          if (format === "mp4-tail") {
            for (let pos = 0; pos + 8 <= original.length; ) {
              const size = original.readUInt32BE(pos);
              if (original.toString("ascii", pos + 4, pos + 8) === "moov") {
                split = pos;
                break;
              }
              if (size < 8) throw new Error("invalid MP4 fixture");
              pos += size;
            }
            if (split === original.length) throw new Error("missing tail moov");
          }
          const gap = logicalSize - original.length;
          if (!isMp4) {
            const segment = original.indexOf(
              Buffer.from([0x18, 0x53, 0x80, 0x67]),
            );
            if (segment < 0 || original[segment + 4] !== 1)
              throw new Error("unexpected WebM segment size");
            const segmentLength = original.length - segment - 12 + gap;
            original.writeBigUInt64BE(
              (1n << 56n) | BigInt(segmentLength),
              segment + 4,
            );
          }
          await file.write(original.subarray(0, split), 0, split, 0);
          const filler = isMp4 ? Buffer.alloc(8) : Buffer.alloc(9);
          if (isMp4) {
            filler.writeUInt32BE(gap, 0);
            filler.write("free", 4);
          } else {
            filler[0] = 0xec;
            filler.writeBigUInt64BE((1n << 56n) | BigInt(gap - 9), 1);
          }
          await file.write(filler, 0, filler.length, split);
          await file.write(
            original.subarray(split),
            0,
            original.length - split,
            split + gap,
          );
          await file.truncate(logicalSize);
          const ranges: string[] = [];
          mockOpenS3Recording.mockResolvedValue(async (range: string) => {
            ranges.push(range);
            const match = /^bytes=(\d+)-(\d+)$/.exec(range);
            if (!match) throw new Error("Unbounded range");
            const start = Number(match[1]);
            const end = Math.min(Number(match[2]), logicalSize - 1);
            const bytes = Buffer.alloc(end - start + 1);
            const result = await file.read(bytes, 0, bytes.length, start);
            if (result.bytesRead !== bytes.length)
              throw new Error("short fixture read");
            return new Response(bytes, {
              status: 206,
              headers: {
                etag: '"stable"',
                "content-range": `bytes ${start}-${end}/${logicalSize}`,
              },
            });
          });
          const recording = makeRecording({
            videoUrl: `https://storage.example.test/clips/rec-1/video.${isMp4 ? "mp4" : "webm"}`,
            videoFormat: isMp4 ? "mp4" : "webm",
            videoSizeBytes: logicalSize,
            storageMode: "own",
          }) as PublicAgentRecording;
          const frames: Buffer[] = [];
          for (const atMs of [100, 1500, 3200]) {
            const expected = await extractJpegFrameFromFile({
              mediaPath: source,
              atMs,
            });
            const media = await loadRecordingMediaFile(recording);
            try {
              const actual = await extractJpegFrameFromFile({
                mediaPath: media.path,
                atMs,
                remote: media.remote,
              });
              expect(Buffer.from(actual)).toEqual(Buffer.from(expected));
              frames.push(Buffer.from(actual));
            } finally {
              await media.cleanup();
            }
          }
          expect(frames[0]).not.toEqual(frames[1]);
          expect(frames[1]).not.toEqual(frames[2]);
          const media = await loadRecordingMediaFile(recording);
          try {
            const fps = await probeFrameSheetFpsFromFile(
              media.path,
              media.remote,
            );
            const plan = planFrameSheet({
              request: { startMs: 0, endMs: 1000, fps },
              fps,
              durationMs: 4000,
              width: 64,
              height: 64,
            });
            if (!plan.ok) throw new Error(plan.error);
            const sheet = await extractJpegFrameSheetFromFile({
              mediaPath: media.path,
              remote: media.remote,
              plan: plan.value,
            });
            expect(Buffer.from(sheet).subarray(0, 2)).toEqual(
              Buffer.from([0xff, 0xd8]),
            );
            if (format === "mp4-tail")
              expect(
                ranges.some(
                  (range) =>
                    Number(range.match(/^bytes=(\d+)/)?.[1]) >
                    512 * 1024 * 1024,
                ),
              ).toBe(true);
            expect(ranges.length).toBeGreaterThan(3);
          } finally {
            await media.cleanup();
          }
        } finally {
          await file.close();
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.each([401, 403, 404, 410])(
    "reports storage HTTP %s safely at the initial and later ranges",
    async (status) => {
      const sensitive = "https://storage.example.test/private/clip.mp4";
      for (const later of [false, true]) {
        let calls = 0;
        let canceled = false;
        mockOpenS3Recording.mockResolvedValue(async () => {
          calls++;
          if (later && calls === 1)
            return new Response("a", {
              status: 206,
              headers: { etag: '"stable"', "content-range": "bytes 0-0/4" },
            });
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(sensitive));
              },
              cancel() {
                canceled = true;
              },
            }),
            { status, statusText: sensitive },
          );
        });
        const recording = makeRecording({
          videoSizeBytes: 100,
          storageMode: "hosted",
        }) as PublicAgentRecording;
        let error: unknown;
        if (later) {
          const media = await loadRecordingMediaFile(recording);
          try {
            error = await extractJpegFrameFromFile({
              mediaPath: media.path,
              atMs: 0,
              remote: media.remote,
            }).catch((err: unknown) => err);
          } finally {
            await media.cleanup();
          }
        } else {
          error = await loadRecordingMediaFile(recording).catch(
            (err: unknown) => err,
          );
        }
        expect(canceled).toBe(true);
        expect(error).toBeInstanceOf(RecordingMediaFetchError);
        expect(frameFailureStatus(error)).toBe(status);
        const failure = describeFrameFailure(error, status);
        expect(failure.failureKind).toBe("media");
        expect(failure.nextStep).toContain(
          status === 401 || status === 403
            ? "denied access"
            : "could not be retrieved",
        );
        expect(JSON.stringify(failure)).not.toContain(sensitive);
      }
    },
  );

  it.each([302, 416, 500])(
    "rejects unexpected storage HTTP %s as a sanitized gateway failure",
    async (status) => {
      const sensitive = "https://storage.example.test/private/clip.mp4";
      mockOpenS3Recording.mockResolvedValue(
        async () => new Response(sensitive, { status, statusText: sensitive }),
      );
      const error = await loadRecordingMediaFile(
        makeRecording({
          videoSizeBytes: 100,
          storageMode: "hosted",
        }) as PublicAgentRecording,
      ).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(RecordingMediaFetchError);
      expect(frameFailureStatus(error)).toBe(502);
      expect(JSON.stringify(describeFrameFailure(error, 502))).not.toContain(
        sensitive,
      );
    },
  );

  it("suggests smaller requests when the range-read budget is exceeded", () => {
    const error = new RecordingMediaFetchError(
      "Recording range budget exceeded.",
      413,
    );
    expect(
      describeFrameFailure(error, frameFailureStatus(error)),
    ).toMatchObject({
      failureKind: "processing",
      nextStep: expect.stringContaining("shorter frame-sheet range"),
    });
    expect(describeFrameFailure(error, 413).nextStep).toContain(
      "individual frames",
    );
    expect(
      describeFrameFailure(new RecordingMediaFetchError("too large", 413), 413)
        .nextStep,
    ).toContain("stored media is too large");
  });

  it("sanitizes signed range setup, header and body failures", async () => {
    const leakedUrl = "https://storage.example.test/clips/private/video.mp4";
    const timeout = Object.assign(
      new Error(`S3 request timed out: ${leakedUrl}`),
      { name: "TimeoutError" },
    );
    const recording = makeRecording({
      videoSizeBytes: 100,
      storageMode: "own",
    }) as PublicAgentRecording;
    const expected = {
      name: "RecordingMediaFetchError",
      statusCode: 504,
      message: "Recording media fetch timed out.",
    };
    mockOpenS3Recording.mockRejectedValueOnce(timeout);
    await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject(
      expected,
    );
    mockOpenS3Recording.mockResolvedValueOnce(async () => {
      throw timeout;
    });
    await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject(
      expected,
    );
    mockOpenS3Recording.mockResolvedValueOnce(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(timeout);
            },
          }),
          {
            status: 206,
            headers: { etag: '"one"', "content-range": "bytes 0-0/100" },
          },
        ),
    );
    await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject(
      expected,
    );
    mockFetchS3ObjectByUrl.mockRejectedValueOnce(timeout);
    await expect(
      loadRecordingMediaBytes(
        makeRecording({ storageMode: "hosted" }) as PublicAgentRecording,
      ),
    ).rejects.toMatchObject(expected);
    // oracle-change: upstream 413 is a gateway failure, covered by agent-frame-storage-error.test.ts.
  });

  it("holds admission for timed-out setups until they settle", async () => {
    vi.useFakeTimers();
    const resolveSetup: Array<
      (
        reader: null | ((range: string, timeout: number) => Promise<Response>),
      ) => void
    > = [];
    const reader = vi.fn(
      async () =>
        new Response("a", {
          status: 206,
          headers: { etag: '"stable"', "content-range": "bytes 0-0/4" },
        }),
    );
    const recording = makeRecording({
      videoSizeBytes: 100,
      storageMode: "own",
    }) as PublicAgentRecording;
    try {
      mockOpenS3Recording.mockReset().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSetup.push(resolve);
          }),
      );
      const first = loadRecordingMediaFile(recording);
      const second = loadRecordingMediaFile(recording);
      const firstTimeout = expect(first).rejects.toMatchObject({
        statusCode: 504,
      });
      const secondTimeout = expect(second).rejects.toMatchObject({
        statusCode: 504,
      });
      await Promise.resolve();
      await Promise.resolve();
      const excess = loadRecordingMediaFile(recording);
      const excessResult = excess.catch((error) => error);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockOpenS3Recording).toHaveBeenCalledTimes(2);
      await expect(excessResult).resolves.toMatchObject({ statusCode: 503 });
      await vi.advanceTimersByTimeAsync(55_000);
      await Promise.all([firstTimeout, secondTimeout]);
      await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject({
        statusCode: 503,
      });
      const [resolveFirst, resolveSecond] = resolveSetup as [
        (typeof resolveSetup)[number],
        (typeof resolveSetup)[number],
      ];
      resolveFirst(reader);
      resolveSecond(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(reader).not.toHaveBeenCalled();
      mockOpenS3Recording.mockResolvedValue(reader);
      const media = await loadRecordingMediaFile(recording);
      await media.cleanup();
    } finally {
      await vi.advanceTimersByTimeAsync(55_000);
      for (const resolve of resolveSetup) resolve(null);
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });

  it("times out stalled storage setup without starting a late range request", async () => {
    vi.useFakeTimers();
    let finish!: (
      reader: (range: string, timeout: number) => Promise<Response>,
    ) => void;
    const reader = vi.fn();
    try {
      mockOpenS3Recording.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const pending = loadRecordingMediaFile(
        makeRecording({
          videoSizeBytes: 100,
          storageMode: "own",
        }) as PublicAgentRecording,
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: "RecordingMediaFetchError",
        statusCode: 504,
      });
      await vi.advanceTimersByTimeAsync(55_000);
      await rejected;
      finish(reader);
      await Promise.resolve();
      expect(reader).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the size cap for oversized sources not bound to S3", async () => {
    mockOpenS3Recording.mockReset().mockResolvedValue(null);
    await expect(
      loadRecordingMediaFile(
        makeRecording({
          videoSizeBytes: 10,
          storageMode: null,
        }) as PublicAgentRecording,
      ),
    ).rejects.toThrow(/too large/i);
    expect(mockOpenS3Recording).not.toHaveBeenCalled();
    await expect(
      loadRecordingMediaFile(
        makeRecording({
          videoSizeBytes: 10,
          storageMode: "own",
        }) as PublicAgentRecording,
      ),
    ).rejects.toThrow(/too large/i);
    expect(mockOpenS3Recording).toHaveBeenCalledTimes(1);
  });

  it("does not open a signed range for an unsupported stored video format", async () => {
    const recording = makeRecording({
      videoSizeBytes: 100,
      storageMode: "own",
    }) as PublicAgentRecording;
    Object.assign(recording, { videoFormat: "unsupported" });
    mockOpenS3Recording.mockReset();
    await expect(loadRecordingMediaFile(recording)).rejects.toThrow(
      /too large/i,
    );
    expect(mockOpenS3Recording).not.toHaveBeenCalled();
  });

  it.each([null, 2])(
    "rejects oversized media with unknown or understated size %s without opening a signed source",
    async (videoSizeBytes) => {
      mockOpenS3Recording.mockReset();
      mockSsrfSafeFetch.mockResolvedValue(
        new Response("1234567", { headers: { "content-length": "7" } }),
      );
      await expect(
        loadRecordingMediaFile(
          makeRecording({
            storageMode: "own",
            videoSizeBytes,
          }) as PublicAgentRecording,
        ),
      ).rejects.toThrow(/too large/i);
      expect(mockOpenS3Recording).not.toHaveBeenCalled();
    },
  );

  it("bounds full media files until cleanup and admits a replacement afterward", async () => {
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    mockSsrfSafeFetch.mockImplementation(async () => new Response("12345"));
    const results = await Promise.allSettled([
      loadRecordingMediaFile(recording),
      loadRecordingMediaFile(recording),
      loadRecordingMediaFile(recording),
    ]);
    const loaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    try {
      expect(loaded).toHaveLength(2);
      expect(
        await Promise.all(loaded.map((media) => readFile(media.path, "utf8"))),
      ).toEqual(["12345", "12345"]);
      expect(results.filter((result) => result.status === "rejected")).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ statusCode: 503 }),
        }),
      ]);
      const first = loaded.find((_, index) => index === 0);
      if (!first) throw new Error("Expected a loaded media file");
      await first.cleanup();
      await first.cleanup();
      const replacement = await loadRecordingMediaFile(recording);
      loaded.push(replacement);
      expect(await readFile(replacement.path, "utf8")).toBe("12345");
      await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject({
        statusCode: 503,
      });
    } finally {
      await Promise.all(loaded.map((media) => media.cleanup()));
    }
  });

  it("removes a partial media file after a failed response stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "clips-frame-cleanup-test-"));
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = root;
    try {
      let partial = "";
      let sent = false;
      mockSsrfSafeFetch.mockResolvedValueOnce(
        new Response(
          new ReadableStream(
            {
              async pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(Buffer.from("123"));
                  return;
                }
                const [dir] = await readdir(root);
                if (!dir) throw new Error("Expected a temporary directory");
                partial = await readFile(join(root, dir, "input.mp4"), "utf8");
                controller.error(new Error("connection reset"));
              },
            },
            { highWaterMark: 0 },
          ),
        ),
      );
      const recording = makeRecording({
        videoFormat: "mp4",
      }) as PublicAgentRecording;
      await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject({
        statusCode: 502,
        message:
          "Recording media download failed while reading the response body.",
      });
      expect(partial).toBe("123");
      expect(await readdir(root)).toEqual([]);
      mockSsrfSafeFetch.mockImplementation(async () => new Response("12345"));
      const media = await loadRecordingMediaFile(recording);
      try {
        expect(await readFile(media.path, "utf8")).toBe("12345");
      } finally {
        await media.cleanup();
      }
      expect(await readdir(root)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries transient removal failures without requiring the caller to retain the handle", async () => {
    mockSsrfSafeFetch.mockImplementation(async () => new Response("12345"));
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    const media = await loadRecordingMediaFile(recording);
    try {
      mockRm.mockRejectedValueOnce(
        Object.assign(new Error("removal failed"), { code: "EACCES" }),
      );
      await expect(media.cleanup()).resolves.toBeUndefined();
      await expect(readFile(media.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await media.cleanup();
    }
  });

  it("reserves available disk across simultaneous full-file requests", async () => {
    const freeBytes = 128 * 1024 * 1024 + 10;
    mockStatfs.mockResolvedValueOnce({ bsize: 1, bavail: freeBytes });
    mockStatfs.mockResolvedValueOnce({ bsize: 1, bavail: freeBytes });
    mockSsrfSafeFetch.mockImplementation(async () => new Response("12345"));
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    const outcomes = await Promise.allSettled([
      loadRecordingMediaFile(recording),
      loadRecordingMediaFile(recording),
    ]);
    const loaded = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : [],
    );
    try {
      expect(loaded).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === "rejected"),
      ).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ statusCode: 503 }),
        }),
      ]);
      const first = loaded.find((_, index) => index === 0);
      if (!first) throw new Error("Expected a loaded media file");
      expect(await readFile(first.path, "utf8")).toBe("12345");
    } finally {
      await Promise.all(loaded.map((media) => media.cleanup()));
    }
  });

  it("does not reserve completed file bytes again after free space decreases", async () => {
    const reserve = 128 * 1024 * 1024;
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES = "8192";
    mockStatfs.mockResolvedValueOnce({ bsize: 1, bavail: reserve + 12288 });
    mockSsrfSafeFetch.mockImplementation(
      async () => new Response(Buffer.alloc(4096, 1)),
    );
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    const first = await loadRecordingMediaFile(recording);
    let second: Awaited<ReturnType<typeof loadRecordingMediaFile>> | undefined;
    try {
      const allocated = Math.min(8192, (await stat(first.path)).blocks * 512);
      expect(allocated).toBeGreaterThan(0);
      mockStatfs.mockResolvedValueOnce({
        bsize: 1,
        bavail: reserve + 8192 - allocated + 4096,
      });
      second = await loadRecordingMediaFile(recording);
      expect((await readFile(second.path)).byteLength).toBe(4096);
    } finally {
      await second?.cleanup();
      await first.cleanup();
    }
  });

  it.each(["remote", "local"])(
    "admits another small %s download while a completed file is held",
    async (source) => {
      const reserve = 128 * 1024 * 1024;
      const available = 1024 * 1024;
      const bytes = Buffer.alloc(4096, 1);
      process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES = String(available);
      process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES = String(available);
      mockStatfs.mockResolvedValueOnce({
        bsize: 1,
        bavail: reserve + available,
      });
      mockSsrfSafeFetch.mockImplementation(async () => new Response(bytes));
      mockAppStateGet.mockResolvedValue({ data: bytes.toString("base64") });
      const recording = makeRecording({
        videoFormat: "mp4",
        ...(source === "local" ? { videoUrl: "/api/video/synthetic" } : {}),
      }) as PublicAgentRecording;
      const first = await loadRecordingMediaFile(recording);
      let second:
        | Awaited<ReturnType<typeof loadRecordingMediaFile>>
        | undefined;
      try {
        const allocated = (await stat(first.path)).blocks * 512;
        expect(allocated).toBeGreaterThan(0);
        expect(allocated + bytes.length).toBeLessThan(available);
        mockStatfs.mockResolvedValueOnce({
          bsize: 1,
          bavail: reserve + available - allocated,
        });
        second = await loadRecordingMediaFile(recording);
        expect(await readFile(first.path)).toEqual(bytes);
        expect(await readFile(second.path)).toEqual(bytes);
      } finally {
        await second?.cleanup();
        await first.cleanup();
      }
    },
  );

  it("keeps a conservative reservation when a file grows during statfs", async () => {
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES = "8192";
    const reserve = 128 * 1024 * 1024;
    mockStatfs.mockResolvedValueOnce({ bsize: 1, bavail: reserve + 12288 });
    let finishSnapshot!: (value: { bsize: number; bavail: number }) => void;
    let snapshotStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      snapshotStarted = resolve;
    });
    mockStatfs.mockImplementationOnce(() => {
      snapshotStarted();
      return new Promise((resolve) => {
        finishSnapshot = resolve;
      });
    });
    let continueDownload!: () => void;
    let downloadPaused!: () => void;
    const paused = new Promise<void>((resolve) => {
      downloadPaused = resolve;
    });
    let sent = false;
    const stream = new ReadableStream(
      {
        async pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(Buffer.alloc(4096, 1));
            return;
          }
          downloadPaused();
          await new Promise<void>((resolve) => {
            continueDownload = resolve;
          });
          controller.enqueue(Buffer.alloc(4096, 1));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    mockSsrfSafeFetch.mockResolvedValueOnce(new Response(stream));
    mockSsrfSafeFetch.mockResolvedValueOnce(
      new Response(Buffer.alloc(8192, 2)),
    );
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    const firstPending = loadRecordingMediaFile(recording);
    await paused;
    const secondPending = loadRecordingMediaFile(recording);
    const secondOutcome = secondPending.then(
      (media) => ({ media }),
      (error: unknown) => ({ error }),
    );
    await started;
    continueDownload();
    const first = await firstPending;
    try {
      const allocated = Math.min(4096, (await stat(first.path)).blocks * 512);
      expect(allocated).toBeGreaterThan(0);
      finishSnapshot({ bsize: 1, bavail: reserve + 12288 - allocated });
      const outcome = await secondOutcome;
      if ("media" in outcome) await outcome.media.cleanup();
      expect(outcome).toMatchObject({
        error: expect.objectContaining({ statusCode: 503 }),
      });
    } finally {
      await first.cleanup();
    }
  });

  it.each(["own", "hosted"] as const)(
    "uses scoped %s ranges for known-sized media when disk space is insufficient",
    async (storageMode) => {
      mockStatfs.mockResolvedValueOnce({
        bsize: 1,
        bavail: 128 * 1024 * 1024 + 2,
      });
      mockSsrfSafeFetch.mockResolvedValue(new Response("12345"));
      mockFetchS3ObjectByUrl.mockResolvedValue(new Response("12345"));
      mockOpenS3Recording.mockResolvedValueOnce(
        async () =>
          new Response("a", {
            status: 206,
            headers: { etag: '"stable"', "content-range": "bytes 0-0/5" },
          }),
      );
      const recording = makeRecording({
        videoFormat: "mp4",
        videoSizeBytes: 5,
        storageMode,
      }) as PublicAgentRecording;
      const media = await loadRecordingMediaFile(recording);
      try {
        expect(media.remote).toBeDefined();
        expect(mockOpenS3Recording).toHaveBeenCalledWith(
          recording.videoUrl,
          expect.objectContaining({ recordingId: recording.id, storageMode }),
        );
        expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
        expect(mockFetchS3ObjectByUrl).not.toHaveBeenCalled();
      } finally {
        await media.cleanup();
      }
    },
  );

  it.each([
    { videoSizeBytes: null, storageMode: "own", videoFormat: "mp4" },
    { videoSizeBytes: 5, storageMode: null, videoFormat: "mp4" },
    { videoSizeBytes: 5, storageMode: "own", videoFormat: "unsupported" },
  ])(
    "does not use ranges for unknown or unsupported sources under disk pressure",
    async (overrides) => {
      mockOpenS3Recording.mockReset();
      mockStatfs.mockResolvedValueOnce({
        bsize: 1,
        bavail: 128 * 1024 * 1024 + 2,
      });
      mockSsrfSafeFetch.mockResolvedValueOnce(new Response("12345"));
      await expect(
        loadRecordingMediaFile(
          makeRecording(overrides as RecordingFixture) as PublicAgentRecording,
        ),
      ).rejects.toMatchObject({ statusCode: 503 });
      expect(mockOpenS3Recording).not.toHaveBeenCalled();
    },
  );

  it("rejects an unbound S3 source under disk pressure without downloading it", async () => {
    mockStatfs.mockResolvedValueOnce({ bsize: 1, bavail: 128 * 1024 * 1024 });
    mockOpenS3Recording.mockResolvedValueOnce(null);
    await expect(
      loadRecordingMediaFile(
        makeRecording({
          videoFormat: "mp4",
          videoSizeBytes: 5,
          storageMode: "own",
        }) as PublicAgentRecording,
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mockOpenS3Recording).toHaveBeenCalledOnce();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("retains admission when cleanup fails and releases it after a retry", async () => {
    mockSsrfSafeFetch.mockImplementation(async () => new Response("12345"));
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    const files = await Promise.all([
      loadRecordingMediaFile(recording),
      loadRecordingMediaFile(recording),
    ]);
    const remove = mockRm.getMockImplementation();
    let blocked = true;
    try {
      mockRm.mockImplementation((path: string, options: unknown) => {
        if (blocked && join(path, "input.mp4") === files[0].path) {
          return Promise.reject(
            Object.assign(new Error("removal failed"), { code: "EACCES" }),
          );
        }
        return remove?.(path, options);
      });
      await expect(files[0].cleanup()).rejects.toMatchObject({
        code: "EACCES",
      });
      expect(await readFile(files[0].path, "utf8")).toBe("12345");
      await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject({
        statusCode: 503,
      });
      blocked = false;
      const replacement = await loadRecordingMediaFile(recording);
      files.push(replacement);
      await expect(readFile(files[0].path)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(replacement.path, "utf8")).toBe("12345");
    } finally {
      if (remove) mockRm.mockImplementation(remove);
      await Promise.all(files.map((media) => media.cleanup()));
    }
  });

  it("retries cleanup after a failed download without touching another directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "clips-frame-retry-test-"));
    const other = await mkdtemp(join(root, "other-worker-"));
    const previous = process.env.TMPDIR;
    const remove = mockRm.getMockImplementation();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let blocked = true;
    process.env.TMPDIR = root;
    try {
      mockRm.mockImplementation((path: string, options: unknown) => {
        if (blocked && path.startsWith(join(root, "clips-agent-frame-"))) {
          return Promise.reject(
            Object.assign(new Error("removal failed"), { code: "EACCES" }),
          );
        }
        return remove?.(path, options);
      });
      mockSsrfSafeFetch.mockResolvedValueOnce(
        new Response(streamThatFailsAfterChunk()),
      );
      const recording = makeRecording({
        videoFormat: "mp4",
      }) as PublicAgentRecording;
      await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject({
        message:
          "Recording media download failed while reading the response body.",
        statusCode: 502,
        cleanupError: expect.objectContaining({ code: "EACCES" }),
      });
      expect(log).toHaveBeenCalledWith(
        "[agent-frame] Media cleanup failed.",
        "EACCES",
      );
      expect(await readdir(root)).toHaveLength(2);
      blocked = false;
      mockSsrfSafeFetch.mockResolvedValueOnce(new Response("12345"));
      const media = await loadRecordingMediaFile(recording);
      try {
        expect(await readFile(media.path, "utf8")).toBe("12345");
        expect(await readdir(root)).toHaveLength(2);
        expect(await readdir(other)).toEqual([]);
      } finally {
        await media.cleanup();
      }
    } finally {
      log.mockRestore();
      if (remove) mockRm.mockImplementation(remove);
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([413, 503, 504])(
    "preserves status %i when download and cleanup fail",
    async (status) => {
      const remove = mockRm.getMockImplementation();
      mockRm.mockRejectedValue(
        Object.assign(new Error("removal failed"), { code: "EACCES" }),
      );
      const recording = makeRecording({
        videoFormat: "mp4",
      }) as PublicAgentRecording;
      if (status === 413) {
        mockSsrfSafeFetch.mockResolvedValueOnce(
          new Response("123456789", {
            headers: { "content-length": String(512 * 1024 * 1024 + 1) },
          }),
        );
      } else {
        mockSsrfSafeFetch.mockResolvedValueOnce(new Response(null, { status }));
      }
      try {
        const error = await loadRecordingMediaFile(recording).catch(
          (failure: unknown) => failure,
        );
        const { frameFailureStatus } = await import("./agent-frame-request.js");
        expect(frameFailureStatus(error)).toBe(status);
        expect(error).toMatchObject({
          cleanupError: expect.objectContaining({ code: "EACCES" }),
        });
      } finally {
        if (remove) mockRm.mockImplementation(remove);
        mockSsrfSafeFetch.mockResolvedValueOnce(new Response("1"));
        const media = await loadRecordingMediaFile(recording);
        await media.cleanup();
      }
    },
  );

  it("fails closed on unavailable or insufficient disk-space information", async () => {
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    mockStatfs.mockRejectedValueOnce(
      Object.assign(new Error("statfs failed /private/temp/path"), {
        code: "EIO",
      }),
    );
    const failure = await loadRecordingMediaFile(recording).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      statusCode: 503,
      message: "Recording temporary storage is unavailable.",
    });
    expect(JSON.stringify(failure)).not.toContain("/private/temp/path");
    const { describeFrameFailure, frameFailureStatus } =
      await import("./agent-frame-request.js");
    expect(
      JSON.stringify(
        describeFrameFailure(failure, frameFailureStatus(failure)),
      ),
    ).not.toContain("/private/temp/path");
    mockStatfs.mockResolvedValueOnce({ bsize: 1, bavail: 128 * 1024 * 1024 });
    await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    mockSsrfSafeFetch.mockImplementation(async () => new Response("12345"));
    const files = await Promise.all([
      loadRecordingMediaFile(recording),
      loadRecordingMediaFile(recording),
    ]);
    await Promise.all(files.map((media) => media.cleanup()));
  });

  it("does not consume file admission when temporary directory setup fails", async () => {
    const previous = process.env.TMPDIR;
    const root = await mkdtemp(join(tmpdir(), "clips-frame-setup-test-"));
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    try {
      process.env.TMPDIR = join(root, "missing");
      mockStatfs.mockResolvedValueOnce({
        bsize: 1,
        bavail: 1024 * 1024 * 1024,
      });
      await expect(loadRecordingMediaFile(recording)).rejects.toMatchObject({
        statusCode: 503,
        message: "Recording temporary storage is unavailable.",
      });
      process.env.TMPDIR = root;
      mockSsrfSafeFetch.mockImplementation(async () => new Response("12345"));
      const media = await Promise.all([
        loadRecordingMediaFile(recording),
        loadRecordingMediaFile(recording),
      ]);
      try {
        expect(
          await Promise.all(media.map((item) => readFile(item.path, "utf8"))),
        ).toEqual(["12345", "12345"]);
      } finally {
        await Promise.all(media.map((item) => item.cleanup()));
      }
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sanitizes a temporary file write failure and releases admission", async () => {
    mockOpen.mockRejectedValueOnce(
      Object.assign(new Error("open /private/temp/path"), {
        code: "ENOSPC",
        syscall: "open",
      }),
    );
    mockSsrfSafeFetch.mockResolvedValueOnce(new Response("12345"));
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    const error = await loadRecordingMediaFile(recording).catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({
      statusCode: 503,
      message: "Recording temporary storage is unavailable.",
    });
    expect(JSON.stringify(error)).not.toContain("/private/temp/path");
    mockSsrfSafeFetch.mockResolvedValueOnce(new Response("12345"));
    const media = await loadRecordingMediaFile(recording);
    await media.cleanup();
  });

  it("caps oversized configuration and cancels a rejected response", async () => {
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES = String(
      1024 * 1024 * 1024,
    );
    let canceled = false;
    mockSsrfSafeFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
        { headers: { "content-length": String(512 * 1024 * 1024 + 1) } },
      ),
    );
    await expect(
      loadRecordingMediaFile(
        makeRecording({ videoFormat: "mp4" }) as PublicAgentRecording,
      ),
    ).rejects.toThrow(/too large/i);
    expect(canceled).toBe(true);
  });

  it("applies the file limit to decoded local blobs before writing", async () => {
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES = "10";
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES = "4";
    mockAppStateGet.mockResolvedValue({
      data: Buffer.from("12345").toString("base64"),
    });
    await expect(
      loadRecordingMediaFile(
        makeRecording({
          videoUrl: "/api/video/synthetic",
        }) as PublicAgentRecording,
      ),
    ).rejects.toThrow(/too large/i);
  });

  it("cancels a stream that exceeds the file limit", async () => {
    let canceled = false;
    mockSsrfSafeFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("1234567"));
          },
          cancel() {
            canceled = true;
          },
        }),
      ),
    );
    await expect(
      loadRecordingMediaFile(makeRecording() as PublicAgentRecording),
    ).rejects.toThrow(/too large/i);
    expect(canceled).toBe(true);
  });

  it("admits range-backed media while both full-file slots are held", async () => {
    process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_FILE_BYTES = "1024";
    mockSsrfSafeFetch.mockImplementation(async () => new Response("12345"));
    mockOpenS3Recording.mockResolvedValue(
      async () =>
        new Response("a", {
          status: 206,
          headers: { etag: '"stable"', "content-range": "bytes 0-0/100" },
        }),
    );
    const recording = makeRecording({
      videoFormat: "mp4",
    }) as PublicAgentRecording;
    const files = await Promise.all([
      loadRecordingMediaFile(recording),
      loadRecordingMediaFile(recording),
    ]);
    try {
      const range = await loadRecordingMediaFile(
        makeRecording({
          videoFormat: "mp4",
          videoSizeBytes: 100,
          storageMode: "own",
        }) as PublicAgentRecording,
      );
      try {
        expect(range.remote).toBeDefined();
      } finally {
        await range.cleanup();
      }
    } finally {
      await Promise.all(files.map((media) => media.cleanup()));
    }
  });

  it("streams large remote frame media to a temporary file", async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(streamFrom([Buffer.from("12"), Buffer.from("345")]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    );

    const result = await loadRecordingMediaFile(
      makeRecording({ videoFormat: "mp4" }) as any,
    );
    try {
      expect(await readFile(result.path, "utf8")).toBe("12345");
      expect(result.mimeType).toBe("video/mp4");
    } finally {
      await result.cleanup();
    }
  });

  it("classifies a failed response-body stream as a media fetch failure", async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(streamThatFailsAfterChunk(), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    );

    await expect(
      loadRecordingMediaFile(makeRecording({ videoFormat: "mp4" }) as any),
    ).rejects.toMatchObject({
      name: "RecordingMediaFetchError",
      statusCode: 502,
      message:
        "Recording media download failed while reading the response body.",
    });
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

  it("does not fetch bytes for YouTube clips", async () => {
    await expect(
      loadRecordingMediaBytes(makeRecording(YOUTUBE_RECORDING) as any),
    ).rejects.toThrow(/YouTube's embedded player/);
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });
});

describe("buildPublicAgentContext", () => {
  it("tells agents a YouTube clip has no frames and offers no frame API", () => {
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
        recording: makeRecording(YOUTUBE_RECORDING) as any,
        viewerIsOwner: false,
        agentLinkCreatorEmail: null,
        apiToken: "signed-token",
      },
      transcript: null,
      agentSegments: [],
      chapters: [{ startMs: 1000, title: "Chapter" }],
      comments: [],
      reactions: [],
      ctas: [],
    });

    expect(context.clip.sourceProvider).toBe("youtube");
    expect(context.apis).not.toHaveProperty("frame");
    expect(context.recommendedFrames).toEqual([]);
    expect(context.instructions.join(" ")).toMatch(/frames aren't available/i);
  });

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
        agentLinkCreatorEmail: null,
        apiToken: "signed-token",
      },
      transcript: null,
      agentSegments: [],
      chapters: [{ startMs: 1000, title: "Chapter" }],
      comments: [],
      reactions: [],
      ctas: [],
    });

    expect(context.clip.sourceProvider).toBe("loom");
    expect(context.apis).not.toHaveProperty("frame");
    expect(context.apis).not.toHaveProperty("frames");
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
        agentLinkCreatorEmail: null,
        apiToken: "signed-token",
      },
      transcript: null,
      agentSegments: [],
      chapters: [{ startMs: 1000, title: "Chapter" }],
      comments: [],
      reactions: [],
      ctas: [],
    });

    expect(context.clip.sourceProvider).toBe("loom");
    expect(context.apis).toHaveProperty("frame");
    expect(context.apis.mcp).toEqual({
      tool: "get-recording-frames",
      connectUrl: "https://clips.example.com/mcp/connect",
    });
    expect(context.apis.frames).toMatchObject({
      method: "GET",
      urlTemplate:
        "https://clips.example.com/api/agent-frames.jpg?id=rec-1&agent_access=signed-token&startMs={startMs}&endMs={endMs}&fps={fps}",
      responseType: "image/jpeg",
      maxFrames: 36,
      maxSpanMs: 60_000,
    });
    expect(
      context.webmcp.http.tools.map((tool: { name: string }) => tool.name),
    ).toContain("clips-get-frames");
    expect(context.instructions.join(" ")).toContain(
      "To watch motion (an animation, a transition, a cursor path), GET apis.frames.urlTemplate",
    );
    expect(context.recommendedFrames.length).toBeGreaterThan(0);
    expect(context.instructions.join(" ")).toMatch(
      /failureKind=processing, follow nextStep/i,
    );
    expect(context.instructions.join(" ")).toMatch(
      /wait clip\.agentReadiness\.retryAfterSeconds and fetch apis\.context\.url/i,
    );
  });

  it("tells agents to wait and retry while a transcript is pending", () => {
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
        agentLinkCreatorEmail: null,
        apiToken: null,
      },
      transcript: {
        status: "pending",
        failureReason: null,
        language: null,
        fullText: "",
      } as any,
      agentSegments: [],
      chapters: [],
      comments: [],
      reactions: [],
      ctas: [],
    });

    expect(context.transcript.status).toBe("pending");
    expect(context.transcript.failureReason).toBe(null);
    expect(context.transcript.retryAfterSeconds).toBe(15);
    expect(context.instructions.join(" ")).toMatch(/wait 15-30 seconds/i);
    expect(context.instructions.join(" ")).toMatch(
      /fetch apis\.context\.url or apis\.transcript\.url again/i,
    );
  });

  it("does not advertise frames while the clip itself is still processing", () => {
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
        recording: makeRecording({ status: "processing" }) as any,
        viewerIsOwner: false,
        agentLinkCreatorEmail: null,
        apiToken: null,
      },
      transcript: null,
      agentSegments: [],
      chapters: [],
      comments: [],
      reactions: [],
      ctas: [],
    });

    expect(context.clip.status).toBe("processing");
    expect(context.clip.agentReadiness).toMatchObject({
      state: "preparing",
      retryAfterSeconds: 15,
    });
    expect(context.instructions.join(" ")).toMatch(/still processing/i);
    expect(context.instructions.join(" ")).toMatch(/wait 15 seconds/i);
    expect(context.apis).not.toHaveProperty("frame");
    expect(context.apis).not.toHaveProperty("frames");
    expect(context.recommendedFrames).toEqual([]);
  });

  it("offers a screenshot's picture but no frame sheet", () => {
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
          kind: "image",
          imageUrl: "https://cdn.example.com/rec-1.png",
        }) as any,
        viewerIsOwner: false,
        agentLinkCreatorEmail: null,
        apiToken: null,
      },
      transcript: null,
      agentSegments: [],
      chapters: [],
      comments: [],
      reactions: [],
      ctas: [],
    });

    expect(context.apis).toHaveProperty("frame");
    expect(context.apis).not.toHaveProperty("frames");
    expect(
      context.webmcp.http.tools.map((tool: { name: string }) => tool.name),
    ).not.toContain("clips-get-frames");
  });

  it("tells agents how to explain exhausted Builder transcription credits", () => {
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
        agentLinkCreatorEmail: null,
        apiToken: null,
      },
      transcript: {
        status: "failed",
        failureReason:
          "Builder transcription credits exhausted. Upgrade your Builder.io plan or configure another supported fallback.",
        language: null,
        fullText: "",
      } as any,
      agentSegments: [],
      chapters: [],
      comments: [],
      reactions: [],
      ctas: [],
    });

    expect(context.transcript.status).toBe("failed");
    expect(context.transcript.failureReason).toMatch(/credits exhausted/i);
    expect(context.instructions.join(" ")).toMatch(
      /Builder transcription credits are exhausted/i,
    );
    expect(context.instructions.join(" ")).toMatch(
      /Builder transcription on the original recording/i,
    );
    expect(context.instructions.join(" ")).toMatch(
      /browser\/macOS native transcript first/i,
    );
  });

  it("omits commenter and reaction email fields from the public payload", () => {
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
        agentLinkCreatorEmail: null,
        apiToken: null,
      },
      transcript: null,
      agentSegments: [],
      chapters: [],
      comments: [
        {
          id: "comment-1",
          recordingId: "rec-1",
          threadId: "thread-1",
          parentId: null,
          authorEmail: "commenter@example.com",
          authorName: "Commenter",
          content: "Looks good",
          videoTimestampMs: 1000,
          emojiReactionsJson: '{"👍":["reactor@example.com"]}',
          resolved: false,
          createdAt: "2026-08-14T00:00:00.000Z",
          updatedAt: "2026-08-14T00:00:00.000Z",
        } as any,
      ],
      reactions: [
        {
          id: "reaction-1",
          emoji: "👍",
          videoTimestampMs: 1000,
          viewerEmail: "reactor@example.com",
          viewerName: "Reactor",
          createdAt: "2026-08-14T00:00:00.000Z",
        } as any,
      ],
      ctas: [],
    });

    expect(context.comments[0]).toEqual({
      id: "comment-1",
      recordingId: "rec-1",
      threadId: "thread-1",
      parentId: null,
      authorName: "Commenter",
      content: "Looks good",
      videoTimestampMs: 1000,
      resolved: false,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(context.comments[0]).not.toHaveProperty("authorEmail");
    expect(context.comments[0]).not.toHaveProperty("emojiReactionsJson");
    expect(context.reactions[0]).toEqual({
      id: "reaction-1",
      emoji: "👍",
      videoTimestampMs: 1000,
      viewerName: "Reactor",
      createdAt: "2026-08-14T00:00:00.000Z",
    });
    expect(context.reactions[0]).not.toHaveProperty("viewerEmail");
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
        agentLinkCreatorEmail: null,
        apiToken: null,
      },
      transcript: null,
      agentSegments: [],
      chapters: [],
      comments: [],
      reactions: [],
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
        timeline: [
          {
            timestampMs: 12,
            elapsedMs: 12,
            kind: "click",
            target: "button#submit",
          },
          {
            timestampMs: 140,
            elapsedMs: 140,
            kind: "network",
            phase: "response",
            type: "fetch",
            method: "GET",
            url: "https://api.example.com/fail?token=<redacted>",
            status: 500,
            durationMs: 120,
          },
        ],
      },
    });

    expect(context.browserDiagnostics?.summary.networkFailureCount).toBe(1);
    expect(context.browserDiagnostics?.timeline).toEqual([
      {
        timestampMs: 12,
        kind: "click",
        target: "button#submit",
        url: null,
      },
      {
        timestampMs: 140,
        kind: "network",
        phase: "response",
        type: "fetch",
        method: "GET",
        url: "https://api.example.com/fail?token=<redacted>",
        status: 500,
        error: null,
        durationMs: 120,
      },
    ]);
    expect(context.browserDiagnostics?.consoleLogs).toEqual([
      {
        timestampMs: 1,
        level: "log",
        message: "Started",
      },
      {
        timestampMs: 2,
        level: "error",
        message: "Failed without token=<redacted>",
      },
    ]);
    expect(context.browserDiagnostics?.consoleIssues).toEqual([
      {
        timestampMs: 2,
        level: "error",
        message: "Failed without token=<redacted>",
      },
    ]);
    expect(context.browserDiagnostics?.networkRequests).toEqual([
      {
        timestampMs: 3,
        type: "fetch",
        method: "GET",
        url: "https://api.example.com/fail?token=<redacted>",
        status: 500,
        error: null,
        durationMs: 120,
      },
      {
        timestampMs: 4,
        type: "xhr",
        method: "POST",
        url: "/ok",
        status: 200,
        error: null,
        durationMs: 40,
      },
    ]);
    expect(context.browserDiagnostics?.failedNetworkRequests).toEqual([
      {
        timestampMs: 3,
        type: "fetch",
        method: "GET",
        url: "https://api.example.com/fail?token=<redacted>",
        status: 500,
        error: null,
        durationMs: 120,
      },
    ]);
    expect(context.browserDiagnostics).not.toHaveProperty("pageUrl");
  });

  it("keeps lookback entries and failures when trimming a busy session", () => {
    const lookback = Array.from({ length: 10 }, (_, index) => ({
      timestampMs: index,
      elapsedMs: -10_000 + index * 1000,
      level: "log" as const,
      message: `before ${index}`,
    }));
    const failure = {
      timestampMs: 20,
      elapsedMs: 5,
      level: "error" as const,
      message: "early failure",
    };
    const later = Array.from({ length: 150 }, (_, index) => ({
      timestampMs: 100 + index,
      elapsedMs: 100 + index,
      level: "log" as const,
      message: `after ${index}`,
    }));
    const consoleLogs = [...lookback, failure, ...later];
    const context = buildPublicAgentContext({
      event: {
        url: new URL(
          "https://clips.example.com/api/agent-context.json?id=rec-1",
        ),
        req: { headers: new Headers() },
      } as any,
      access: {
        recording: makeRecording() as any,
        viewerIsOwner: false,
        agentLinkCreatorEmail: null,
        apiToken: null,
      },
      transcript: null,
      agentSegments: [],
      chapters: [],
      comments: [],
      reactions: [],
      ctas: [],
      browserDiagnostics: {
        pageUrl: null,
        userAgent: null,
        startedAt: "2026-06-22T10:00:00.000Z",
        endedAt: "2026-06-22T10:01:00.000Z",
        summary: {
          consoleCount: consoleLogs.length,
          consoleErrorCount: 1,
          consoleWarnCount: 0,
          networkCount: 0,
          networkFailureCount: 0,
          capturedAt: "2026-06-22T10:01:00.000Z",
        },
        consoleLogs,
        networkRequests: [],
        timeline: consoleLogs.map((entry) => ({ ...entry, kind: "console" })),
      },
    });

    const kept = context.browserDiagnostics!.consoleLogs.map(
      (entry) => entry.message,
    );
    expect(kept).toHaveLength(100);
    expect(kept.slice(0, 11)).toEqual([
      ...lookback.map((entry) => entry.message),
      "early failure",
    ]);
    expect(kept[kept.length - 1]).toBe("after 149");
    expect(kept).not.toContain("after 60");
    expect(
      context.browserDiagnostics!.timeline.filter(
        (entry) => entry.timestampMs < 0,
      ),
    ).toHaveLength(10);
  });

  it("splits a trimmed list between lookback and the recording instead of keeping only lookback", () => {
    const consoleLogs = [
      ...Array.from({ length: 150 }, (_, index) => ({
        timestampMs: index,
        elapsedMs: -15_000 + index * 100,
        level: "log" as const,
        message: `before ${index}`,
      })),
      ...Array.from({ length: 150 }, (_, index) => ({
        timestampMs: 1_000 + index,
        elapsedMs: index * 100,
        level: "log" as const,
        message: `during ${index}`,
      })),
    ];
    const context = buildPublicAgentContext({
      event: {
        url: new URL(
          "https://clips.example.com/api/agent-context.json?id=rec-1",
        ),
        req: { headers: new Headers() },
      } as any,
      access: {
        recording: makeRecording() as any,
        viewerIsOwner: false,
        agentLinkCreatorEmail: null,
        apiToken: null,
      },
      transcript: null,
      agentSegments: [],
      chapters: [],
      comments: [],
      reactions: [],
      ctas: [],
      browserDiagnostics: {
        pageUrl: null,
        userAgent: null,
        startedAt: "2026-06-22T10:00:00.000Z",
        endedAt: "2026-06-22T10:01:00.000Z",
        summary: {
          consoleCount: consoleLogs.length,
          consoleErrorCount: 0,
          consoleWarnCount: 0,
          networkCount: 0,
          networkFailureCount: 0,
          capturedAt: "2026-06-22T10:01:00.000Z",
        },
        consoleLogs,
        networkRequests: [],
      },
    });

    const kept = context.browserDiagnostics!.consoleLogs.map(
      (entry) => entry.message,
    );
    expect(kept).toHaveLength(100);
    expect(kept.filter((message) => message.startsWith("before"))).toEqual(
      Array.from({ length: 50 }, (_, index) => `before ${100 + index}`),
    );
    expect(kept.filter((message) => message.startsWith("during"))).toEqual(
      Array.from({ length: 50 }, (_, index) => `during ${100 + index}`),
    );
    expect(kept[49]).toBe("before 149");
    expect(kept[50]).toBe("during 100");
  });

  it("adds the app activity summary and lists its events API only for a scoped link", () => {
    const appActivity = {
      app: "mail",
      build: "dev",
      eventCount: 12,
      failureCount: 1,
      dropped: 0,
      coverage: [{ fromElapsedMs: -30_000, toElapsedMs: 9_000 }],
      failures: [
        {
          timestampMs: 1_760_000_000_000,
          elapsedMs: -800,
          type: "action" as const,
          name: "list-folders",
          ok: false,
          status: 403,
          errorCode: "forbidden_scope",
        },
      ],
    };
    const build = (
      access: {
        viewerIsOwner: boolean;
        agentLinkCreatorEmail: string | null;
        apiToken: string | null;
      },
      appActivityEventsReadable = false,
    ) =>
      buildPublicAgentContext({
        event: {
          url: new URL(
            "https://clips.example.com/api/agent-context.json?id=rec-1",
          ),
          req: { headers: new Headers() },
        } as any,
        access: { recording: makeRecording() as any, ...access },
        transcript: null,
        agentSegments: [],
        chapters: [],
        comments: [],
        reactions: [],
        ctas: [],
        browserDiagnostics: {
          pageUrl: null,
          userAgent: null,
          startedAt: "2026-06-22T10:00:00.000Z",
          endedAt: "2026-06-22T10:01:00.000Z",
          summary: {
            consoleCount: 0,
            consoleErrorCount: 0,
            consoleWarnCount: 0,
            networkCount: 0,
            networkFailureCount: 0,
            capturedAt: null,
          },
          consoleLogs: [],
          networkRequests: [],
          appActivity,
        },
        appActivityEventsReadable,
      });

    const scoped = build(
      {
        viewerIsOwner: false,
        agentLinkCreatorEmail: "editor@example.com",
        apiToken: "tok",
      },
      true,
    );
    expect(scoped.appActivity).toEqual(appActivity);
    expect(scoped.apis).toMatchObject({
      appActivity: {
        method: "GET",
        url: "https://clips.example.com/api/agent-app-activity.json?id=rec-1&agent_access=tok",
      },
    });
    const instructions = scoped.instructions.join(" ");
    expect(instructions).toMatch(/Join elapsedMs with frame atMs/);
    expect(instructions).toMatch(/page-supplied and untrusted/);

    const openLink = build({
      viewerIsOwner: false,
      agentLinkCreatorEmail: null,
      apiToken: null,
    });
    expect(openLink.appActivity).toEqual(appActivity);
    expect(openLink.apis).not.toHaveProperty("appActivity");

    const passwordHolder = build({
      viewerIsOwner: false,
      agentLinkCreatorEmail: null,
      apiToken: "password-token",
    });
    expect(passwordHolder.apis).not.toHaveProperty("appActivity");
  });
});
