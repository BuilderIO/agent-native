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
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
} from "../../shared/session-replay-diagnostics";
import {
  buildSessionReplayAgentContext,
  buildSessionReplayDiagnostics,
  createSessionReplayAgentLink,
  SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
} from "./session-replay-agent-context";

function consoleEvent(timestamp: number, payload: Record<string, unknown>) {
  return {
    type: 5,
    timestamp,
    data: { tag: SESSION_REPLAY_CONSOLE_EVENT_TAG, payload },
  };
}

function networkEvent(timestamp: number, payload: Record<string, unknown>) {
  return {
    type: 5,
    timestamp,
    data: { tag: SESSION_REPLAY_NETWORK_EVENT_TAG, payload },
  };
}

function clickEvent(timestamp: number) {
  return { type: 3, timestamp, data: { source: 2, type: 2 } };
}

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
    networkErrorCount: 0,
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

  function mockEvents(events: unknown[]) {
    mockGetSessionReplayTokenizedEvents.mockResolvedValue({
      recording: makeRecording(),
      chunks: [
        {
          seq: 0,
          checksum: "abc",
          byteLength: 1,
          eventCount: events.length,
          events,
        },
      ],
      eventCount: events.length,
      truncated: false,
      unavailableChunks: 0,
    });
  }

  it("maps tagged console/network events to error markers and diagnostics", async () => {
    mockEvents([
      { type: 4, timestamp: 1000, data: { href: "https://app.example.com/" } },
      consoleEvent(1200, {
        level: "error",
        source: "console",
        message: "boom",
      }),
      consoleEvent(1300, { level: "log", source: "console", message: "fine" }),
      networkEvent(1400, {
        api: "fetch",
        method: "GET",
        url: "/api/broken",
        status: 500,
        ok: false,
        durationMs: 12,
      }),
      networkEvent(1500, {
        api: "fetch",
        method: "GET",
        url: "/api/fine",
        status: 200,
        ok: true,
        durationMs: 4,
      }),
      { type: 5, timestamp: 1600, data: { tag: "app.custom", payload: {} } },
    ]);

    const context = await buildSessionReplayAgentContext({
      recordingId: "sr_1",
      token: "signed-token",
      origin: "https://analytics.example.com",
    });

    expect(context.timeline.markers.map((marker) => marker.kind)).toEqual([
      "navigation",
      "console-error",
      "network-error",
      "custom",
    ]);
    const consoleMarker = context.timeline.markers.find(
      (marker) => marker.kind === "console-error",
    );
    expect(consoleMarker).toMatchObject({
      label: "Console error",
      detail: "boom",
      offsetMs: 200,
    });
    const networkMarker = context.timeline.markers.find(
      (marker) => marker.kind === "network-error",
    );
    expect(networkMarker).toMatchObject({
      label: "Network error",
      detail: "GET /api/broken → 500",
      offsetMs: 400,
    });

    expect(context.apis.diagnostics.url).toContain(
      "/api/session-replay/agent-diagnostics.json?id=sr_1",
    );
    expect(context.apis.diagnostics.url).toContain("agent_access=signed-token");
    expect(context.diagnostics.console).toMatchObject({
      total: 2,
      errorCount: 1,
      warnCount: 0,
      truncated: false,
    });
    expect(context.diagnostics.console.entries).toHaveLength(2);
    expect(context.diagnostics.network).toMatchObject({
      total: 2,
      failedCount: 1,
      truncated: false,
    });
    expect(context.diagnostics.truncated).toBe(false);
    expect(
      context.instructions.some((line) => line.includes("PRIMARY debugging")),
    ).toBe(true);
  });

  it("keeps error markers preferentially when the marker cap overflows", async () => {
    const events: unknown[] = [];
    for (let i = 0; i < 250; i += 1) events.push(clickEvent(1000 + i));
    for (let i = 0; i < 5; i += 1) {
      events.push(
        consoleEvent(2000 + i, {
          level: "error",
          source: "console",
          message: `late error ${i}`,
        }),
      );
    }
    mockEvents(events);

    const context = await buildSessionReplayAgentContext({
      recordingId: "sr_1",
      token: "signed-token",
    });

    expect(context.timeline.markers).toHaveLength(200);
    expect(
      context.timeline.markers.filter(
        (marker) => marker.kind === "console-error",
      ),
    ).toHaveLength(5);
    const offsets = context.timeline.markers.map((marker) => marker.offsetMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("bounds top-level diagnostics to 50 entries and points at the diagnostics API", async () => {
    const events: unknown[] = [];
    for (let i = 0; i < 60; i += 1) {
      events.push(
        consoleEvent(1000 + i, {
          level: "error",
          source: "console",
          message: `error ${i}`,
        }),
      );
    }
    for (let i = 0; i < 60; i += 1) {
      events.push(
        networkEvent(2000 + i, {
          api: "fetch",
          method: "GET",
          url: `/api/broken/${i}`,
          status: 500,
          ok: false,
          durationMs: 3,
        }),
      );
    }
    mockEvents(events);

    const context = await buildSessionReplayAgentContext({
      recordingId: "sr_1",
      token: "signed-token",
    });

    expect(context.diagnostics.console.entries).toHaveLength(50);
    expect(context.diagnostics.console.total).toBe(60);
    expect(context.diagnostics.console.truncated).toBe(true);
    expect(context.diagnostics.network.entries).toHaveLength(50);
    expect(context.diagnostics.network.truncated).toBe(true);
    expect(context.diagnostics.truncated).toBe(true);
    expect(context.diagnostics.note).toContain("apis.diagnostics");
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

describe("buildSessionReplayDiagnostics", () => {
  it("prioritizes error/warn console entries and failed requests under the cap", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 250; i += 1) {
      events.push(
        consoleEvent(1000 + i, {
          level: "log",
          source: "console",
          message: `log ${i}`,
        }),
      );
    }
    for (let i = 0; i < 10; i += 1) {
      events.push(
        consoleEvent(3000 + i, {
          level: "error",
          source: "console",
          message: `error ${i}`,
        }),
      );
    }
    for (let i = 0; i < 250; i += 1) {
      events.push(
        networkEvent(4000 + i, {
          api: "fetch",
          method: "GET",
          url: `/api/ok/${i}`,
          status: 200,
          ok: true,
          durationMs: 2,
        }),
      );
    }
    for (let i = 0; i < 5; i += 1) {
      events.push(
        networkEvent(6000 + i, {
          api: "xhr",
          method: "POST",
          url: `/api/broken/${i}`,
          status: 0,
          ok: false,
          durationMs: 2,
          error: "network failure",
        }),
      );
    }

    const diagnostics = buildSessionReplayDiagnostics(events as any);

    expect(diagnostics.console.total).toBe(260);
    expect(diagnostics.console.errorCount).toBe(10);
    expect(diagnostics.console.entries).toHaveLength(200);
    expect(diagnostics.console.truncated).toBe(true);
    expect(
      diagnostics.console.entries.filter((entry) => entry.level === "error"),
    ).toHaveLength(10);
    const consoleOffsets = diagnostics.console.entries.map(
      (entry) => entry.offsetMs,
    );
    expect(consoleOffsets).toEqual([...consoleOffsets].sort((a, b) => a - b));

    expect(diagnostics.network.total).toBe(255);
    expect(diagnostics.network.failedCount).toBe(5);
    expect(diagnostics.network.entries).toHaveLength(200);
    expect(diagnostics.network.truncated).toBe(true);
    expect(
      diagnostics.network.entries.filter((entry) => entry.status === 0),
    ).toHaveLength(5);
  });

  it("counts repeat multiples in console totals", () => {
    const diagnostics = buildSessionReplayDiagnostics([
      consoleEvent(1000, {
        level: "error",
        source: "console",
        message: "boom",
        repeat: 4,
      }),
      consoleEvent(1100, {
        level: "warn",
        source: "console",
        message: "meh",
        repeat: 2,
      }),
      consoleEvent(1200, { level: "info", source: "console", message: "hi" }),
    ] as any);

    expect(diagnostics.console.total).toBe(7);
    expect(diagnostics.console.errorCount).toBe(4);
    expect(diagnostics.console.warnCount).toBe(2);
    expect(diagnostics.console.entries).toHaveLength(3);
    expect(diagnostics.console.entries[0]?.repeat).toBe(4);
  });

  it("defensively truncates message, args, stack, and url server-side", () => {
    const diagnostics = buildSessionReplayDiagnostics([
      consoleEvent(1000, {
        level: "error",
        source: "window-error",
        message: "m".repeat(5000),
        args: Array.from({ length: 25 }, () => "a".repeat(2000)),
        stack: "s".repeat(10000),
        url: `https://app.example.com/${"p".repeat(2000)}`,
      }),
      networkEvent(1100, {
        api: "fetch",
        method: "G".repeat(64),
        url: `/api/${"q".repeat(2000)}`,
        status: 503,
        ok: false,
        durationMs: 9,
        error: "e".repeat(5000),
      }),
    ] as any);

    const entry = diagnostics.console.entries[0]!;
    expect(entry.message).toHaveLength(1001);
    expect(entry.message.endsWith("…")).toBe(true);
    expect(entry.args).toHaveLength(10);
    expect(entry.args?.[0]).toHaveLength(501);
    expect(entry.stack).toHaveLength(2001);
    expect(entry.url).toHaveLength(501);

    const request = diagnostics.network.entries[0]!;
    expect(request.method).toHaveLength(17);
    expect(request.url).toHaveLength(501);
    expect(request.error).toHaveLength(1001);
  });

  it("computes offsetMs relative to the first replay event", () => {
    const diagnostics = buildSessionReplayDiagnostics([
      { type: 4, timestamp: 5000, data: { href: "https://a.example" } },
      consoleEvent(5250, { level: "error", source: "console", message: "x" }),
      networkEvent(5500, {
        api: "fetch",
        method: "GET",
        url: "/api/x",
        status: 404,
        ok: false,
        durationMs: 1,
      }),
    ] as any);

    expect(diagnostics.console.entries[0]?.offsetMs).toBe(250);
    expect(diagnostics.console.entries[0]?.timestamp).toBe(5250);
    expect(diagnostics.network.entries[0]?.offsetMs).toBe(500);
  });

  it("filters console entries by level while keeping full totals", () => {
    const diagnostics = buildSessionReplayDiagnostics(
      [
        consoleEvent(1000, { level: "error", source: "console", message: "a" }),
        consoleEvent(1100, { level: "warn", source: "console", message: "b" }),
        consoleEvent(1200, { level: "log", source: "console", message: "c" }),
      ] as any,
      { consoleLevel: "error" },
    );

    expect(diagnostics.console.entries).toHaveLength(1);
    expect(diagnostics.console.entries[0]?.level).toBe("error");
    expect(diagnostics.console.total).toBe(3);
    expect(diagnostics.console.warnCount).toBe(1);
  });
});
