import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetHeader = vi.hoisted(() => vi.fn());
const mockGetQuery = vi.hoisted(() => vi.fn());
const mockGetRequestURL = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockSetCookie = vi.hoisted(() => vi.fn());
const mockSignShortLivedToken = vi.hoisted(() => vi.fn());
const mockSignScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());
const mockVerifySharePassword = vi.hoisted(() => vi.fn());
const mockResolvePlayerVideoUrl = vi.hoisted(() => vi.fn());
const mockBuildAgentApiUrls = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => mockGetHeader(...args),
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  getRequestURL: (...args: unknown[]) => mockGetRequestURL(...args),
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
  setCookie: (...args: unknown[]) => mockSetCookie(...args),
}));

vi.mock("drizzle-orm", () => ({
  asc: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  signShortLivedToken: (...args: unknown[]) => mockSignShortLivedToken(...args),
  signScopedAgentAccessToken: (...args: unknown[]) =>
    mockSignScopedAgentAccessToken(...args),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mockVerifyScopedAgentAccessToken(...args),
}));

vi.mock("../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordings: { id: "recordings.id" },
    recordingTranscripts: { recordingId: "transcripts.recordingId" },
    recordingComments: {
      recordingId: "comments.recordingId",
      videoTimestampMs: "comments.videoTimestampMs",
      createdAt: "comments.createdAt",
    },
    recordingReactions: {
      recordingId: "reactions.recordingId",
      createdAt: "reactions.createdAt",
    },
    recordingCtas: {
      recordingId: "ctas.recordingId",
      createdAt: "ctas.createdAt",
    },
  },
}));

vi.mock("../../lib/recordings.js", () => ({
  parseSpaceIds: vi.fn(() => []),
}));

vi.mock("../../lib/player-video-url.js", () => ({
  resolvePlayerVideoUrl: (...args: unknown[]) =>
    mockResolvePlayerVideoUrl(...args),
}));

vi.mock("../../lib/share-password.js", () => ({
  verifySharePassword: (...args: unknown[]) => mockVerifySharePassword(...args),
}));

vi.mock("../../../shared/agent-context.js", () => ({
  agentAccessTokenResourceId: (recordingId: string) =>
    `clip-agent-context:${recordingId}`,
  buildAgentApiUrls: (...args: unknown[]) => mockBuildAgentApiUrls(...args),
  CLIP_AGENT_ACCESS_TOKEN_PREFIX: "clip-agent-context",
  CLIPS_AGENT_ACCESS_PARAM: "agent_access",
}));

vi.mock("../../../shared/transcript-segments.js", () => ({
  normalizeTranscriptSegments: vi.fn(() => []),
  parseTranscriptSegments: vi.fn(() => []),
}));

import handler from "./public-recording.get";

function createDbWithSelectResults(results: unknown[][]) {
  let index = 0;
  return {
    select: vi.fn(() => {
      const rows = results[index++] ?? [];
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        orderBy: vi.fn(async () => rows),
        limit: vi.fn(async () => rows),
      };
      return builder;
    }),
  };
}

function makeRecording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    title: "Protected clip",
    description: null,
    thumbnailUrl: null,
    animatedThumbnailUrl: null,
    sourceAppName: "Screen Recorder",
    durationMs: 120_000,
    editsJson: null,
    videoFormat: "mp4",
    width: 1920,
    height: 1080,
    hasAudio: true,
    hasCamera: false,
    status: "ready",
    uploadProgress: 100,
    failureReason: null,
    password: "encrypted-password",
    expiresAt: null,
    enableComments: false,
    enableReactions: false,
    enableDownloads: true,
    defaultSpeed: 1.2,
    animatedThumbnailEnabled: false,
    visibility: "public",
    ownerEmail: "owner@example.com",
    archivedAt: null,
    trashedAt: null,
    chaptersJson: "[]",
    spaceIds: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("/api/public-recording route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignShortLivedToken.mockReset();
    mockSignScopedAgentAccessToken.mockReset();
    mockVerifyScopedAgentAccessToken.mockReset();
    mockGetHeader.mockReturnValue(undefined);
    mockGetQuery.mockReturnValue({ id: "rec-1", password: "open-sesame" });
    mockGetRequestURL.mockReturnValue(
      new URL("https://clips.example/share/rec-1"),
    );
    mockSetCookie.mockImplementation((event, name, value, options) => {
      event.setCookies.push({ name, value, options });
    });
    mockGetSession.mockResolvedValue(null);
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
    mockVerifySharePassword.mockReturnValue(true);
    mockResolvePlayerVideoUrl.mockReturnValue("/api/video/rec-1");
    mockSignScopedAgentAccessToken.mockReturnValue("agent-token");
    mockSignShortLivedToken
      .mockReturnValueOnce("media-token")
      .mockReturnValueOnce("unused-media-token");
    mockBuildAgentApiUrls.mockReturnValue({
      contextUrl: "https://clips.example/api/agent-context.json?id=rec-1",
    });
  });

  it("sets a protected media cookie and long fallback token after password unlock", async () => {
    const event = { setCookies: [] as unknown[] };
    mockGetDb.mockReturnValue(
      createDbWithSelectResults([[makeRecording()], [], [], [], []]),
    );

    const result = await handler(event as any);

    expect(result).toMatchObject({
      recording: { videoUrl: "/api/video/rec-1?t=media-token" },
    });
    expect(mockSignShortLivedToken).toHaveBeenCalledWith({
      resourceId: "rec-1",
      ttlSeconds: 21_600,
    });
    expect(mockSetCookie).toHaveBeenCalledWith(
      event,
      "clips_media_rec-1",
      "media-token",
      expect.objectContaining({
        httpOnly: true,
        maxAge: 21_600,
        path: "/api/video/rec-1",
        sameSite: "none",
        secure: true,
        partitioned: true,
      }),
    );
    expect(mockResolvePlayerVideoUrl).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rec-1" }),
      expect.objectContaining({ addPasswordToken: false }),
    );
  });

  it("allows a scoped agent access token to load private clips without changing visibility", async () => {
    const event = { setCookies: [] as unknown[] };
    mockGetQuery.mockReturnValue({
      id: "rec-1",
      agent_access: "agent-token",
    });
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    mockGetDb.mockReturnValue(
      createDbWithSelectResults([
        [
          makeRecording({
            visibility: "private",
            password: null,
          }),
        ],
        [],
        [],
        [],
        [],
      ]),
    );

    const result = await handler(event as any);

    expect(result).toMatchObject({
      recording: {
        id: "rec-1",
        visibility: "private",
        videoUrl: "/api/video/rec-1?t=media-token",
      },
    });
    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith(
      "agent-token",
      {
        resourceKind: "clip-agent-context",
        resourceId: "rec-1",
      },
    );
    expect(mockSetResponseStatus).not.toHaveBeenCalledWith(event, 404);
    expect(mockBuildAgentApiUrls).toHaveBeenCalledWith(
      "rec-1",
      expect.objectContaining({ token: "agent-token" }),
    );
  });
});
