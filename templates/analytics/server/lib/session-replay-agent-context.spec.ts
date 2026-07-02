import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestContext = vi.hoisted(() => vi.fn());
const mockSignShortLivedToken = vi.hoisted(() => vi.fn());
const mockVerifyShortLivedToken = vi.hoisted(() => vi.fn());
const mockGetSessionReplaySummary = vi.hoisted(() => vi.fn());
const mockGetSessionReplayTokenizedSummary = vi.hoisted(() => vi.fn());
const mockGetSessionReplayTokenizedEvents = vi.hoisted(() => vi.fn());
const mockCompactSessionRecordingSummary = vi.hoisted(() =>
  vi.fn((recording: any) => {
    const {
      metadata: _metadata,
      ownerEmail: _ownerEmail,
      orgId: _orgId,
      visibility: _visibility,
      role: _role,
      canEdit: _canEdit,
      canManage: _canManage,
      ...compact
    } = recording;
    return compact;
  }),
);

vi.mock("@agent-native/core/server", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
  signShortLivedToken: (...args: unknown[]) => mockSignShortLivedToken(...args),
  verifyShortLivedToken: (...args: unknown[]) =>
    mockVerifyShortLivedToken(...args),
}));

vi.mock("./session-replay.js", () => ({
  compactSessionRecordingSummary: (recording: unknown) =>
    mockCompactSessionRecordingSummary(recording),
  getSessionReplaySummary: (...args: unknown[]) =>
    mockGetSessionReplaySummary(...args),
  getSessionReplayTokenizedSummary: (...args: unknown[]) =>
    mockGetSessionReplayTokenizedSummary(...args),
  getSessionReplayTokenizedEvents: (...args: unknown[]) =>
    mockGetSessionReplayTokenizedEvents(...args),
}));

import {
  buildSessionReplayAgentContext,
  createSessionReplayAgentLink,
  SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
} from "./session-replay-agent-context";

function makeRecording(overrides: Record<string, unknown> = {}) {
  return {
    id: "sr_1",
    clientRecordingId: "client_1",
    sessionId: "session_1",
    userId: "dev@example.com",
    anonymousId: null,
    userKey: "dev@example.com",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:04.000Z",
    durationMs: 4000,
    chunkCount: 1,
    eventCount: 2,
    totalBytes: 128,
    pageCount: 1,
    errorCount: 0,
    rageClickCount: 0,
    privacyMode: "default",
    firstUrl: "https://app.example.com/start",
    lastUrl: "https://app.example.com/end",
    path: "/end",
    hostname: "app.example.com",
    referrer: null,
    app: "example",
    template: "web",
    status: "completed",
    metadata: {},
    ownerEmail: "owner@example.com",
    orgId: "org_1",
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:04.000Z",
    lastIngestedAt: "2026-01-01T00:00:04.000Z",
    ...overrides,
  };
}

describe("session replay agent context links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestContext.mockReturnValue({
      requestOrigin: "https://analytics.example.com",
    });
    mockSignShortLivedToken.mockReturnValue("signed-token");
    mockVerifyShortLivedToken.mockReturnValue({ ok: true });
    mockGetSessionReplaySummary.mockResolvedValue(makeRecording());
    mockGetSessionReplayTokenizedSummary.mockResolvedValue(makeRecording());
    mockGetSessionReplayTokenizedEvents.mockResolvedValue({
      recording: makeRecording(),
      chunks: [
        {
          seq: 0,
          checksum: "abc",
          byteLength: 128,
          eventCount: 2,
          events: [
            {
              type: 4,
              timestamp: 1000,
              data: { href: "https://app.example.com/start" },
            },
            {
              type: 3,
              timestamp: 1250,
              data: { source: 2, type: 2 },
            },
          ],
        },
      ],
      eventCount: 2,
      truncated: false,
      unavailableChunks: 0,
    });
  });

  it("mints scoped two-hour session replay agent links", async () => {
    const link = await createSessionReplayAgentLink({
      recordingId: "sr_1",
      scope: { userEmail: "owner@example.com", orgId: "org_1" },
      origin: "https://analytics.example.com",
    });

    expect(mockSignShortLivedToken).toHaveBeenCalledWith({
      resourceId: "analytics-session-replay-agent-context:sr_1",
      viewerEmail: "owner@example.com",
      ttlSeconds: SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
    });
    expect(link.url).toBe(
      "https://analytics.example.com/sessions/sr_1?agent_access=signed-token",
    );
    expect(link.contextUrl).toBe(
      "https://analytics.example.com/api/session-replay/agent-context.json?id=sr_1&agent_access=signed-token",
    );
    expect(link.ttlSeconds).toBe(2 * 60 * 60);
  });

  it("builds bounded agent context for valid tokens", async () => {
    const context = await buildSessionReplayAgentContext({
      recordingId: "sr_1",
      token: "signed-token",
      origin: "https://analytics.example.com",
    });

    expect(mockVerifyShortLivedToken).toHaveBeenCalledWith(
      "signed-token",
      "analytics-session-replay-agent-context:sr_1",
    );
    expect(context.apis.page.url).toBe(
      "https://analytics.example.com/sessions/sr_1?agent_access=signed-token",
    );
    expect(context.apis.events.url).toContain(
      "/api/session-replay/agent-events.json?id=sr_1",
    );
    expect(context.timeline.markerCount).toBe(2);
    expect(context.timeline.markers.map((marker) => marker.kind)).toEqual([
      "navigation",
      "click",
    ]);
  });

  it("rejects invalid agent access tokens", async () => {
    mockVerifyShortLivedToken.mockReturnValue({ ok: false });

    await expect(
      buildSessionReplayAgentContext({
        recordingId: "sr_1",
        token: "bad-token",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid or expired agent access",
    });
  });
});
