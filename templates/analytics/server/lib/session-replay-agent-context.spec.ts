import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestContext = vi.hoisted(() => vi.fn());
const mockCreateScopedAgentAccessGrant = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const mockGetSessionReplaySummary = vi.hoisted(() => vi.fn());
const mockGetSessionReplayEvents = vi.hoisted(() => vi.fn());
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

const mockIsSessionsTriageLabEnabled = vi.hoisted(() => vi.fn());

vi.mock("./sessions-triage-lab.js", () => ({
  isSessionsTriageLabEnabled: (...args: unknown[]) =>
    mockIsSessionsTriageLabEnabled(...args),
  sessionsTriageReadFailure: () =>
    "Couldn't read the Sessions triage Lab state.",
}));

vi.mock("@agent-native/core/server", () => ({
  buildAgentAccessApiUrl: ({
    endpoint,
    resourceId,
    token,
    origin,
    basePath,
    extraParams,
  }: any) => {
    const params = new URLSearchParams({ id: resourceId });
    if (token) params.set("agent_access", token);
    for (const [key, value] of extraParams ?? [])
      params.set(key, String(value));
    return `${origin ?? ""}${basePath ?? ""}${endpoint}?${params.toString()}`;
  },
  buildAgentAccessUrl: ({ path, token, origin, basePath }: any) =>
    `${origin ?? ""}${basePath ?? ""}${path}?agent_access=${encodeURIComponent(
      token,
    )}`,
  createScopedAgentAccessGrant: (...args: unknown[]) =>
    mockCreateScopedAgentAccessGrant(...args),
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mockVerifyScopedAgentAccessToken(...args),
}));

vi.mock("./session-replay.js", () => ({
  compactSessionRecordingSummary: (recording: unknown) =>
    mockCompactSessionRecordingSummary(recording),
  getSessionReplaySummary: (...args: unknown[]) =>
    mockGetSessionReplaySummary(...args),
  getSessionReplayEvents: (...args: unknown[]) =>
    mockGetSessionReplayEvents(...args),
  getSessionReplayTokenizedSummary: (...args: unknown[]) =>
    mockGetSessionReplayTokenizedSummary(...args),
  getSessionReplayTokenizedEvents: (...args: unknown[]) =>
    mockGetSessionReplayTokenizedEvents(...args),
}));

import { isSessionlessAnalyticsRoute } from "../../app/lib/sessionless-route";
import {
  SESSION_REPLAY_AGENT_CHAT_EVENT_TAG,
  SESSION_REPLAY_ANALYTICS_EVENT_TAG,
  SESSION_REPLAY_NAVIGATION_EVENT_TAG,
} from "../../shared/session-events";
import {
  SESSION_REPLAY_SLOW_REQUEST_EVENT_TAG,
  SESSION_REPLAY_VITALS_EVENT_TAG,
} from "../../shared/session-performance";
import {
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
} from "../../shared/session-replay-diagnostics";
import {
  buildSessionReplayAgentContext,
  buildSessionReplayDiagnostics,
  createSessionReplayAgentLink,
  getSessionReplayTimeline,
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

describe("session replay key moments", () => {
  const STARTED_AT = Date.parse("2026-01-01T00:00:00.000Z");
  const FIRST_EVENT_AT = STARTED_AT + 500;
  const COMMIT = "a".repeat(40);
  const at = (ms: number) => FIRST_EVENT_AT + ms;

  const meta = (ms: number, path: string) => ({
    type: 4,
    timestamp: at(ms),
    data: { href: `https://app.example.com${path}?secret=1` },
  });
  const routeChange = (ms: number, path: string) => ({
    type: 5,
    timestamp: at(ms),
    data: { tag: SESSION_REPLAY_NAVIGATION_EVENT_TAG, payload: { path } },
  });
  const namedEvent = (ms: number, name: string) => ({
    type: 5,
    timestamp: at(ms),
    data: { tag: SESSION_REPLAY_ANALYTICS_EVENT_TAG, payload: { name } },
  });
  const click = (ms: number, id = 2) => ({
    type: 3,
    timestamp: at(ms),
    data: { source: 2, type: 2, id, x: 10, y: 10 },
  });
  const answer = (ms: number) => ({
    type: 3,
    timestamp: at(ms),
    data: { source: 0, adds: [], removes: [], texts: [], attributes: [] },
  });
  const typed = (ms: number, id = 3) => ({
    type: 3,
    timestamp: at(ms),
    data: { source: 5, id, text: "a private draft" },
  });
  const snapshot = {
    type: 2,
    timestamp: FIRST_EVENT_AT,
    data: {
      node: {
        type: 0,
        id: 1,
        childNodes: [
          {
            type: 2,
            id: 2,
            tagName: "button",
            attributes: {},
            childNodes: [{ type: 3, id: 4, textContent: "Send" }],
          },
          {
            type: 2,
            id: 3,
            tagName: "input",
            attributes: { placeholder: "Prompt" },
            childNodes: [],
          },
        ],
      },
    },
  };

  function serve(
    events: unknown[],
    response: { truncated?: boolean; unavailableChunks?: number } = {},
    recording: Record<string, unknown> = {},
  ) {
    const summary = makeRecording({ metadata: {}, ...recording });
    mockGetSessionReplayTokenizedSummary.mockResolvedValue(summary);
    mockGetSessionReplayTokenizedEvents.mockResolvedValue({
      recording: summary,
      chunks: [{ seq: 0, events }],
      eventCount: events.length,
      truncated: response.truncated ?? false,
      unavailableChunks: response.unavailableChunks ?? 0,
    });
  }

  const readContext = (options: { includeTimeline?: boolean } = {}) =>
    buildSessionReplayAgentContext({
      recordingId: "sr_1",
      token: "signed-token",
      origin: "https://analytics.example.com",
      ...options,
    }) as Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestContext.mockReturnValue({
      requestOrigin: "https://analytics.example.com",
    });
    mockCreateScopedAgentAccessGrant.mockReturnValue({
      token: "signed-token",
      expiresAt: "2026-01-01T02:00:00.000Z",
      ttlSeconds: SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
    });
    mockVerifyScopedAgentAccessToken.mockReturnValue({
      ok: true,
      agentLabel: "sessions-triage",
    });
    mockGetSessionReplaySummary.mockResolvedValue(makeRecording());
    mockIsSessionsTriageLabEnabled.mockResolvedValue(true);
    serve([meta(0, "/start")]);
  });

  it("marks a new link only when its creator's Lab is on, and never names them", async () => {
    const scope = { userEmail: "owner@example.com", orgId: "org_1" };

    mockIsSessionsTriageLabEnabled.mockResolvedValue(false);
    await createSessionReplayAgentLink({ recordingId: "sr_1", scope });
    expect(mockCreateScopedAgentAccessGrant).toHaveBeenLastCalledWith({
      resourceKind: "analytics-session-replay-agent-context",
      resourceId: "sr_1",
      ttlSeconds: SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
    });

    mockIsSessionsTriageLabEnabled.mockResolvedValue(true);
    await createSessionReplayAgentLink({ recordingId: "sr_1", scope });
    expect(mockCreateScopedAgentAccessGrant).toHaveBeenLastCalledWith({
      resourceKind: "analytics-session-replay-agent-context",
      resourceId: "sr_1",
      ttlSeconds: SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
      agentLabel: "sessions-triage",
    });
  });

  it("still makes a link when the Lab state can't be read, and says so", async () => {
    mockIsSessionsTriageLabEnabled.mockRejectedValue(new Error("db down"));

    const link = await createSessionReplayAgentLink({
      recordingId: "sr_1",
      scope: { userEmail: "owner@example.com", orgId: "org_1" },
    });

    expect(link.url).toContain("agent_access=signed-token");
    expect(link.labStateError).toBe(
      "Couldn't read the Sessions triage Lab state.",
    );
    expect(
      mockCreateScopedAgentAccessGrant.mock.calls[0]?.[0],
    ).not.toHaveProperty("agentLabel");
  });

  it("keeps the old shape on a link made with the Lab off", async () => {
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    serve([meta(0, "/start"), routeChange(10, "/deck"), click(20)]);

    const context = await readContext();

    expect(context).not.toHaveProperty("keyMoments");
    expect(context).not.toHaveProperty("build");
    expect(context.instructions.join(" ")).not.toContain("keyMoments");
    expect(context.timeline.markers.map((marker: any) => marker.kind)).toEqual([
      "navigation",
      "click",
    ]);
  });

  it("takes the Lab from the link, so opening it reads no one's settings", async () => {
    const context = await readContext();

    expect(context).toHaveProperty("keyMoments");
    expect(mockIsSessionsTriageLabEnabled).not.toHaveBeenCalled();
  });

  it("returns nothing it did not read when the timeline is skipped", async () => {
    const context = await readContext({ includeTimeline: false });

    expect(context).not.toHaveProperty("keyMoments");
    expect(context.build.commit).toBeNull();
  });

  it("finds every kind of moment, in time order", async () => {
    serve([
      snapshot,
      meta(0, "/start"),
      routeChange(0, "/start"),
      namedEvent(100, "deck_created"),
      namedEvent(110, "pageview"),
      consoleEvent(at(200), {
        level: "error",
        message: "Boom",
        url: "https://app.example.com/start?secret=1",
      }),
      consoleEvent(at(210), { level: "warn", message: "Careful" }),
      networkEvent(at(300), {
        method: "POST",
        url: "https://app.example.com/api/uploads?secret=1",
        status: 503,
      }),
      networkEvent(at(310), {
        method: "GET",
        url: "https://app.example.com/api/ok",
        status: 200,
      }),
      networkEvent(at(320), {
        method: "GET",
        url: "https://app.example.com/api/left",
        status: 0,
        pageLeaving: true,
      }),
      networkEvent(at(400), {
        method: "POST",
        url: "https://app.example.com/_agent-native/actions/create-deck",
        status: 500,
      }),
      routeChange(500, "/deck/1"),
      click(10_000),
      click(10_100),
      click(10_200),
      answer(10_250),
      click(20_000),
      answer(22_000),
    ]);

    const { keyMoments } = await readContext();

    expect(
      keyMoments.moments.map((moment: any) => [
        moment.kind,
        moment.label,
        moment.detail,
        moment.route,
      ]),
    ).toEqual([
      ["navigation", "/start", null, "/start"],
      ["event", "deck_created", null, "/start"],
      ["console-error", "Console error", "Boom", "/start"],
      ["network-error", "Network error", "POST /api/uploads → 503", "/start"],
      [
        "failed-action",
        "Action failed: create-deck",
        "POST /_agent-native/actions/create-deck → 500",
        "/start",
      ],
      ["navigation", "/deck/1", null, "/deck/1"],
      ["rage-click", "Rage click", 'button "Send"', "/deck/1"],
      ["dead-click", "Dead click", 'button "Send"', "/deck/1"],
    ]);
    expect(keyMoments).toMatchObject({
      total: 8,
      omitted: 0,
      truncated: false,
      complete: true,
    });
    expect(keyMoments).not.toHaveProperty("routeNote");
  });

  describe("errors the person saw", () => {
    const failedRun = (ms: number, payload: Record<string, unknown> = {}) => ({
      type: 5,
      timestamp: at(ms),
      data: {
        tag: SESSION_REPLAY_AGENT_CHAT_EVENT_TAG,
        payload: { phase: "run-failed", surface: "app", ...payload },
      },
    });
    const runStarted = (ms: number) => ({
      type: 5,
      timestamp: at(ms),
      data: {
        tag: SESSION_REPLAY_AGENT_CHAT_EVENT_TAG,
        payload: { phase: "run-observed", surface: "app" },
      },
    });
    const addedText = (ms: number, heading: string, message: string) => ({
      type: 3,
      timestamp: at(ms),
      data: {
        source: 0,
        attributes: [],
        adds: [
          { parentId: 1, node: { type: 2, id: 90, tagName: "div" } },
          { parentId: 90, node: { type: 2, id: 91, tagName: "div" } },
          { parentId: 91, node: { type: 3, id: 92, textContent: heading } },
          { parentId: 90, node: { type: 2, id: 93, tagName: "p" } },
          { parentId: 93, node: { type: 3, id: 94, textContent: message } },
        ],
      },
    });
    const errorMoments = (keyMoments: any) =>
      keyMoments.moments
        .filter((moment: any) => moment.kind === "agent-error")
        .map((moment: any) => [moment.label, moment.detail]);

    it("names a failed run from the recorder's mark, with its code", async () => {
      serve([
        snapshot,
        runStarted(100),
        failedRun(200, { errorCode: "provider_rejected" }),
        failedRun(10_000, { errorCode: "http_429", recoverable: true }),
      ]);

      const { keyMoments } = await readContext();

      expect(errorMoments(keyMoments)).toEqual([
        ["Agent run failed", "provider_rejected"],
        ["Agent run stopped before finishing", "http_429"],
      ]);
      expect(keyMoments.moments[0].stepsBefore).toEqual([
        { offsetMs: 100, kind: "agent", label: "Agent run started" },
      ]);
    });

    it("reads a failed run off the screen in an older recording", async () => {
      serve([
        snapshot,
        addedText(100, "The agent hit an error", "Unsupported parameter"),
      ]);

      const { keyMoments } = await readContext();

      expect(errorMoments(keyMoments)).toEqual([
        ["The agent hit an error", "Unsupported parameter"],
      ]);
    });

    it("does not count a failed run twice when it is both marked and shown", async () => {
      serve([
        snapshot,
        addedText(100, "The agent run failed before it finished.", "*****"),
        failedRun(100, { errorCode: "provider_rejected" }),
      ]);

      const { keyMoments } = await readContext();

      expect(errorMoments(keyMoments)).toEqual([
        ["Agent run failed", "provider_rejected"],
      ]);
    });
  });

  it("measures atMs from the recording's start, as the player does", async () => {
    serve([
      meta(0, "/start"),
      consoleEvent(at(1_000), { level: "error", message: "Boom" }),
    ]);

    const context = await readContext();
    const moment = context.keyMoments.moments.find(
      (found: any) => found.kind === "console-error",
    );

    expect(moment.offsetMs).toBe(1_000);
    expect(moment.atMs).toBe(1_500);
  });

  describe("playerUrl", () => {
    const boom = (ms: number) =>
      consoleEvent(at(ms), { level: "error", message: "Boom" });
    const playerUrlOf = async () => {
      const context = await readContext();
      return new URL(
        context.keyMoments.moments.find(
          (found: any) => found.kind === "console-error",
        ).playerUrl,
      );
    };

    it("opens without a session, since an agent holds only the link", async () => {
      serve([meta(0, "/start"), boom(1_000), click(9_000)]);

      const playerUrl = await playerUrlOf();

      expect(playerUrl.pathname).toBe("/sessions/sr_1");
      expect(playerUrl.searchParams.get("agent_access")).toBe("signed-token");
      expect(
        isSessionlessAnalyticsRoute(playerUrl.pathname, playerUrl.search),
      ).toBe(true);
    });

    it("stops just after the moment, so its effect is on screen", async () => {
      serve([meta(0, "/start"), boom(1_000), click(9_000)]);

      const playerUrl = await playerUrlOf();

      expect(playerUrl.searchParams.get("atMs")).toBe("2500");
      expect(playerUrl.searchParams.get("capture_through_ms")).toBe("2500");
    });

    it("stops at the last event for a moment near the recording's end", async () => {
      serve([meta(0, "/start"), boom(1_000), click(1_300)]);

      const playerUrl = await playerUrlOf();

      expect(playerUrl.searchParams.get("atMs")).toBe("1800");
    });

    it("gives no link for a moment past what the frame will open", async () => {
      const eightDays = 8 * 24 * 60 * 60 * 1_000;
      serve([meta(0, "/start"), boom(eightDays)]);

      const { keyMoments } = await readContext();

      expect(keyMoments.moments.at(-1)).toMatchObject({
        kind: "console-error",
        playerUrl: null,
      });
    });
  });

  it("gives no time or link when the recording's start can't be read", async () => {
    serve(
      [consoleEvent(at(1_000), { level: "error", message: "Boom" })],
      {},
      { startedAt: "not a date" },
    );

    const { keyMoments } = await readContext();

    expect(keyMoments.moments[0]).toMatchObject({
      offsetMs: 0,
      atMs: null,
      playerUrl: null,
    });
  });

  it("says what the person did before a moment, without what they typed", async () => {
    serve([
      snapshot,
      routeChange(0, "/start"),
      typed(100),
      typed(200),
      click(1_000),
      namedEvent(2_000, "prompt_sent"),
      answer(2_100),
      click(30_000, 99),
      answer(30_100),
      routeChange(40_000, "/deck/1"),
      consoleEvent(at(50_000), { level: "error", message: "Boom" }),
    ]);

    const { keyMoments } = await readContext();
    const moment = keyMoments.moments.find(
      (found: any) => found.kind === "console-error",
    );

    expect(moment.stepsBefore.map((step: any) => step.label)).toEqual([
      'Type in input "Prompt"',
      'Click button "Send"',
      "prompt_sent",
      "Click",
      "/deck/1",
    ]);
    expect(JSON.stringify(keyMoments)).not.toContain("a private draft");
  });

  it("keeps the last five steps and folds a burst of the same step", async () => {
    serve([
      snapshot,
      routeChange(0, "/start"),
      typed(100),
      typed(200),
      typed(300),
      answer(301),
      namedEvent(1_000, "one"),
      namedEvent(2_000, "two"),
      namedEvent(3_000, "three"),
      namedEvent(4_000, "four"),
      consoleEvent(at(5_000), { level: "error", message: "Boom" }),
    ]);

    const { keyMoments } = await readContext();
    const moment = keyMoments.moments.find(
      (found: any) => found.kind === "console-error",
    );

    expect(moment.stepsBefore.map((step: any) => step.label)).toEqual([
      'Type in input "Prompt"',
      "one",
      "two",
      "three",
      "four",
    ]);

    const burst = keyMoments.moments.find(
      (found: any) => found.label === "one",
    );
    expect(burst.stepsBefore).toEqual([
      { offsetMs: 0, kind: "navigation", label: "/start" },
      { offsetMs: 100, kind: "input", label: 'Type in input "Prompt"' },
    ]);
  });

  it("folds the same failure repeating within a few seconds", async () => {
    const failed = (ms: number) =>
      networkEvent(at(ms), {
        method: "POST",
        url: "https://app.example.com/api/run",
        status: 500,
      });
    serve([
      failed(1_000),
      failed(4_000),
      failed(8_000),
      failed(20_000),
      consoleEvent(at(9_000), { level: "error", message: "Boom", repeat: 4 }),
    ]);

    const { keyMoments } = await readContext();

    expect(
      keyMoments.moments.map((moment: any) => [
        moment.kind,
        moment.offsetMs,
        moment.repeatCount,
      ]),
    ).toEqual([
      ["network-error", 0, 3],
      ["console-error", 8_000, 4],
      ["network-error", 19_000, 1],
    ]);
  });

  it("does not repeat a page load's route when the recorder restarts", async () => {
    serve([meta(0, "/start"), meta(60_000, "/start"), meta(70_000, "/next")]);

    const { keyMoments } = await readContext();

    expect(keyMoments.moments.map((moment: any) => moment.label)).toEqual([
      "/start",
      "/next",
    ]);
  });

  it("keeps what broke over navigation when it has to cut", async () => {
    const events: unknown[] = [];
    for (let i = 0; i < 40; i += 1) {
      events.push(routeChange(i * 10_000, `/page/${i}`));
    }
    events.push(namedEvent(5, "deck_created"));
    events.push(
      consoleEvent(at(500_000), { level: "error", message: "Late boom" }),
    );
    serve(events);

    const { keyMoments } = await readContext();
    const kinds = keyMoments.moments.map((moment: any) => moment.kind);

    expect(keyMoments.moments).toHaveLength(40);
    expect(keyMoments).toMatchObject({
      total: 42,
      omitted: 2,
      truncated: true,
    });
    expect(kinds).toContain("console-error");
    expect(kinds).toContain("event");
    const offsets = keyMoments.moments.map((moment: any) => moment.offsetMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it.each([
    ["the events were cut short", { truncated: true }],
    ["a chunk could not be read", { unavailableChunks: 1 }],
  ])("is not complete when %s", async (_label, response) => {
    serve([meta(0, "/start")], response);

    const { keyMoments } = await readContext();

    expect(keyMoments.complete).toBe(false);
  });

  it("is not complete when the recorder stopped capturing failures", async () => {
    serve([
      meta(0, "/start"),
      networkEvent(at(100), {
        message: "session replay network capture truncated",
        truncated: true,
      }),
    ]);

    const { keyMoments } = await readContext();

    expect(keyMoments.complete).toBe(false);
    expect(keyMoments.moments.map((moment: any) => moment.kind)).toEqual([
      "navigation",
    ]);
  });

  it("leaves a route unknown in a recording from before route tracking", async () => {
    serve([
      meta(0, "/home"),
      networkEvent(at(100), {
        method: "POST",
        url: "https://app.example.com/api/run",
        status: 500,
      }),
      consoleEvent(at(200), {
        level: "error",
        message: "Boom",
        url: "https://app.example.com/deck/1",
      }),
    ]);

    const { keyMoments } = await readContext();

    expect(keyMoments.moments.map((moment: any) => moment.route)).toEqual([
      "/home",
      null,
      "/deck/1",
    ]);
    expect(keyMoments.routeNote).toContain("null route means unknown");
  });

  it("names the commit only when the recording reported a real one", async () => {
    serve([], {}, { metadata: { commit_sha: COMMIT.toUpperCase() } });
    expect((await readContext()).build).toEqual({ commit: COMMIT });

    serve([], {}, { metadata: { commit_sha: "not-a-commit" } });
    const invalid = (await readContext()).build;
    expect(invalid.commit).toBeNull();
    expect(invalid.note).toContain("did not report a commit");

    serve([], {}, { metadata: {} });
    expect((await readContext()).build.commit).toBeNull();
  });
});

describe("session replay agent context links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSessionsTriageLabEnabled.mockResolvedValue(false);
    mockGetRequestContext.mockReturnValue({
      requestOrigin: "https://analytics.example.com",
    });
    mockCreateScopedAgentAccessGrant.mockReturnValue({
      token: "signed-token",
      expiresAt: "2026-01-01T02:00:00.000Z",
      ttlSeconds: SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
    });
    mockVerifyScopedAgentAccessToken.mockReturnValue({
      ok: true,
      viewerEmail: "owner@example.com",
    });
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

    expect(mockCreateScopedAgentAccessGrant).toHaveBeenCalledWith({
      resourceKind: "analytics-session-replay-agent-context",
      resourceId: "sr_1",
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

    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith(
      "signed-token",
      {
        resourceKind: "analytics-session-replay-agent-context",
        resourceId: "sr_1",
      },
    );
    expect(mockGetSessionReplayTokenizedSummary).toHaveBeenCalledWith(
      "sr_1",
      "owner@example.com",
    );
    expect(mockGetSessionReplayTokenizedEvents).toHaveBeenCalledWith(
      "sr_1",
      "owner@example.com",
      { limit: 10000 },
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

  it("accepts recording-scoped agent access without a viewer identity claim", async () => {
    mockVerifyScopedAgentAccessToken.mockReturnValueOnce({ ok: true });

    await buildSessionReplayAgentContext({
      recordingId: "sr_1",
      token: "scoped-token-without-viewer-email",
      origin: "https://analytics.example.com",
      includeTimeline: false,
    });

    expect(mockGetSessionReplayTokenizedSummary).toHaveBeenCalledWith(
      "sr_1",
      undefined,
    );
  });

  it("returns sanitized timeline markers without raw replay events", async () => {
    mockGetSessionReplayEvents.mockResolvedValue({
      recording: makeRecording(),
      chunks: [
        {
          seq: 0,
          checksum: "abc",
          byteLength: 1,
          eventCount: 5,
          events: [
            {
              type: 4,
              timestamp: 1000,
              data: { href: "https://app.test/start?email=secret@example.com" },
            },
            clickEvent(1200),
            {
              type: 3,
              timestamp: 1300,
              data: { source: 5, text: "secret input" },
            },
            networkEvent(1400, {
              api: "fetch",
              method: "GET",
              url: "https://api.test/failure?token=secret-network-token",
              status: 500,
              ok: false,
              durationMs: 12,
            }),
            {
              type: 5,
              timestamp: 1500,
              data: {
                tag: "app.custom",
                payload: { message: "secret custom payload" },
              },
            },
          ],
        },
      ],
      eventCount: 3,
      truncated: false,
      unavailableChunks: 0,
    });

    const timeline = await getSessionReplayTimeline("sr_1", {
      userEmail: "owner@example.com",
      orgId: "org_1",
    });

    expect(timeline.recording.id).toBe("sr_1");
    expect(timeline.markers.map((marker) => marker.kind)).toEqual([
      "navigation",
      "click",
      "input",
      "network-error",
      "custom",
    ]);
    expect(JSON.stringify(timeline)).not.toContain("secret@example.com");
    expect(JSON.stringify(timeline)).not.toContain("secret input");
    expect(JSON.stringify(timeline)).not.toContain("secret-network-token");
    expect(JSON.stringify(timeline)).not.toContain("secret custom payload");
    expect(timeline.markers[3]?.detail).toBe("GET /failure → 500");
    expect(timeline).not.toHaveProperty("chunks");
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
      // Markers the Sessions triage Lab owns stay off agent timelines.
      ...[
        SESSION_REPLAY_ANALYTICS_EVENT_TAG,
        SESSION_REPLAY_VITALS_EVENT_TAG,
        SESSION_REPLAY_SLOW_REQUEST_EVENT_TAG,
      ].map((tag, index) => ({
        type: 5,
        timestamp: 1700 + index,
        data: { tag, payload: { action: "save-clip", duration_ms: 1_500 } },
      })),
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

  it("collapses continuous same-element scroll events into bursts", async () => {
    mockEvents([
      { type: 4, timestamp: 1_000, data: { href: "https://app.example.com/" } },
      { type: 3, timestamp: 2_000, data: { source: 3, id: 1, y: 100 } },
      { type: 3, timestamp: 2_200, data: { source: 3, id: 1, y: 220 } },
      { type: 3, timestamp: 2_500, data: { source: 3, id: 2, y: 80 } },
      { type: 3, timestamp: 2_900, data: { source: 3, id: 1, y: 480 } },
      { type: 3, timestamp: 4_100, data: { source: 3, id: 1, y: 900 } },
    ]);

    const context = await buildSessionReplayAgentContext({
      recordingId: "sr_1",
      token: "signed-token",
      origin: "https://analytics.example.com",
    });

    const scrolls = context.timeline.markers.filter(
      (marker) => marker.kind === "scroll",
    );
    expect(scrolls).toHaveLength(3);
    expect(scrolls.map((marker) => marker.offsetMs)).toEqual([
      1_000, 1_500, 3_100,
    ]);
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
    expect(context.timeline).toMatchObject({
      markerCount: 200,
      totalMarkerCount: 255,
      markerTruncated: true,
      omittedMarkerCount: 55,
      eventsTruncated: false,
      truncated: true,
    });
    expect(
      context.timeline.markers.filter(
        (marker) => marker.kind === "console-error",
      ),
    ).toHaveLength(5);
    const offsets = context.timeline.markers.map((marker) => marker.offsetMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));

    mockGetSessionReplayEvents.mockResolvedValueOnce({
      recording: makeRecording(),
      chunks: [{ seq: 0, checksum: "abc", byteLength: 1, events }],
      eventCount: events.length,
      truncated: false,
      unavailableChunks: 0,
    });
    const timeline = await getSessionReplayTimeline("sr_1", {
      userEmail: "owner@example.com",
      orgId: "org_1",
    });
    expect(timeline).toMatchObject({
      markerCount: 200,
      totalMarkerCount: 255,
      markerTruncated: true,
      omittedMarkerCount: 55,
      eventsTruncated: false,
      truncated: true,
    });
  });

  it("marks aggregate timelines incomplete when replay chunks are unavailable", async () => {
    const event = clickEvent(1_000);
    const response = {
      recording: makeRecording(),
      chunks: [
        {
          seq: 0,
          checksum: "abc",
          byteLength: 1,
          eventCount: 1,
          events: [event],
        },
      ],
      eventCount: 1,
      truncated: false,
      unavailableChunks: 1,
    };
    mockGetSessionReplayEvents.mockResolvedValueOnce(response);
    mockGetSessionReplayTokenizedEvents.mockResolvedValueOnce(response);

    const timeline = await getSessionReplayTimeline("sr_1", {
      userEmail: "owner@example.com",
      orgId: "org_1",
    });
    const context = await buildSessionReplayAgentContext({
      recordingId: "sr_1",
      token: "signed-token",
    });

    expect(timeline).toMatchObject({
      eventsTruncated: false,
      unavailableChunks: 1,
      truncated: true,
    });
    expect(context.timeline).toMatchObject({
      eventsTruncated: false,
      unavailableChunks: 1,
      truncated: true,
    });
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
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });

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

  it("passes through a 5xx responseBody and defensively re-truncates it server-side", () => {
    const diagnostics = buildSessionReplayDiagnostics([
      networkEvent(1000, {
        api: "fetch",
        method: "GET",
        url: "/api/broken",
        status: 502,
        ok: false,
        durationMs: 12,
        responseBody: '{"error":"boom"}',
      }),
      networkEvent(1100, {
        api: "fetch",
        method: "GET",
        url: "/api/huge-broken",
        status: 500,
        ok: false,
        durationMs: 9,
        responseBody: "b".repeat(5000),
      }),
      networkEvent(1200, {
        api: "fetch",
        method: "GET",
        url: "/api/ok",
        status: 200,
        ok: true,
        durationMs: 4,
      }),
    ] as any);

    expect(diagnostics.network.entries[0]?.responseBody).toBe(
      '{"error":"boom"}',
    );
    expect(diagnostics.network.entries[1]?.responseBody).toHaveLength(2049);
    expect(diagnostics.network.entries[1]?.responseBody?.endsWith("…")).toBe(
      true,
    );
    expect(diagnostics.network.entries[2]?.responseBody).toBeUndefined();
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

  it("defaults hasMore to false when nothing is truncated", () => {
    const diagnostics = buildSessionReplayDiagnostics([
      consoleEvent(1000, { level: "log", source: "console", message: "a" }),
      networkEvent(1100, {
        api: "fetch",
        method: "GET",
        url: "/api/ok",
        status: 200,
        ok: true,
        durationMs: 2,
      }),
    ] as any);

    expect(diagnostics.console.hasMore).toBe(false);
    expect(diagnostics.network.hasMore).toBe(false);
  });

  it("sets hasMore alongside truncated when the errors-first cap overflows", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 20; i += 1) {
      events.push(
        consoleEvent(1000 + i, {
          level: "log",
          source: "console",
          message: `log ${i}`,
        }),
      );
    }
    const diagnostics = buildSessionReplayDiagnostics(events as any, {
      maxConsoleEntries: 5,
    });

    expect(diagnostics.console.truncated).toBe(true);
    expect(diagnostics.console.hasMore).toBe(true);
  });

  it("keeps default errors-first ordering when no paging params are given", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      events.push(
        consoleEvent(1000 + i, {
          level: "log",
          source: "console",
          message: `log ${i}`,
        }),
      );
    }
    events.push(
      consoleEvent(2000, {
        level: "error",
        source: "console",
        message: "boom",
      }),
    );
    const diagnostics = buildSessionReplayDiagnostics(events as any, {
      maxConsoleEntries: 3,
    });

    expect(diagnostics.console.entries).toHaveLength(3);
    expect(
      diagnostics.console.entries.some((entry) => entry.level === "error"),
    ).toBe(true);
    expect(diagnostics.console.truncated).toBe(true);
    expect(diagnostics.console.hasMore).toBe(true);
  });

  it("switches to strictly chronological ordering when offset is provided", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      events.push(
        consoleEvent(1000 + i, {
          level: "log",
          source: "console",
          message: `log ${i}`,
        }),
      );
    }
    events.push(
      consoleEvent(2000, {
        level: "error",
        source: "console",
        message: "boom",
      }),
    );

    const diagnostics = buildSessionReplayDiagnostics(events as any, {
      maxConsoleEntries: 3,
      offset: 0,
    });

    expect(diagnostics.console.entries.map((entry) => entry.message)).toEqual([
      "log 0",
      "log 1",
      "log 2",
    ]);
    expect(diagnostics.console.truncated).toBe(true);
    expect(diagnostics.console.hasMore).toBe(true);
  });

  it("pages through offset to produce disjoint pages that union to the full chronological set", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 25; i += 1) {
      events.push(
        consoleEvent(1000 + i, {
          level: i % 7 === 0 ? "error" : "log",
          source: "console",
          message: `entry ${i}`,
        }),
      );
    }

    const pageSize = 10;
    const pages: string[][] = [];
    for (let offset = 0; offset < 30; offset += pageSize) {
      const diagnostics = buildSessionReplayDiagnostics(events as any, {
        maxConsoleEntries: pageSize,
        offset,
      });
      pages.push(diagnostics.console.entries.map((entry) => entry.message));
      if (!diagnostics.console.hasMore) break;
    }

    expect(pages).toEqual([
      Array.from({ length: 10 }, (_, i) => `entry ${i}`),
      Array.from({ length: 10 }, (_, i) => `entry ${i + 10}`),
      Array.from({ length: 5 }, (_, i) => `entry ${i + 20}`),
    ]);
    const union = pages.flat();
    expect(union).toHaveLength(25);
    expect(new Set(union).size).toBe(25);
  });

  it("windows entries by fromMs/toMs (inclusive) and reflects totals for the windowed population", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      events.push(
        consoleEvent(1000 + i * 100, {
          level: "log",
          source: "console",
          message: `entry ${i}`,
        }),
      );
    }

    const diagnostics = buildSessionReplayDiagnostics(events as any, {
      fromMs: 200,
      toMs: 500,
    });

    expect(diagnostics.console.entries.map((entry) => entry.message)).toEqual([
      "entry 2",
      "entry 3",
      "entry 4",
      "entry 5",
    ]);
    expect(diagnostics.console.total).toBe(4);
    expect(diagnostics.console.truncated).toBe(false);
    expect(diagnostics.console.hasMore).toBe(false);
  });

  it("combines fromMs/toMs windowing with offset paging", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      events.push(
        consoleEvent(1000 + i * 100, {
          level: "log",
          source: "console",
          message: `entry ${i}`,
        }),
      );
    }

    const diagnostics = buildSessionReplayDiagnostics(events as any, {
      fromMs: 200,
      toMs: 900,
      offset: 2,
      maxConsoleEntries: 2,
    });

    expect(diagnostics.console.total).toBe(8);
    expect(diagnostics.console.entries.map((entry) => entry.message)).toEqual([
      "entry 4",
      "entry 5",
    ]);
    expect(diagnostics.console.hasMore).toBe(true);
  });

  it("windows network entries by fromMs/toMs the same way as console", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 6; i += 1) {
      events.push(
        networkEvent(1000 + i * 100, {
          api: "fetch",
          method: "GET",
          url: `/api/${i}`,
          status: i === 0 ? 500 : 200,
          ok: i !== 0,
          durationMs: 2,
        }),
      );
    }

    const diagnostics = buildSessionReplayDiagnostics(events as any, {
      fromMs: 100,
      toMs: 300,
    });

    expect(diagnostics.network.entries.map((entry) => entry.url)).toEqual([
      "/api/1",
      "/api/2",
      "/api/3",
    ]);
    expect(diagnostics.network.total).toBe(3);
    expect(diagnostics.network.hasMore).toBe(false);
  });
});
