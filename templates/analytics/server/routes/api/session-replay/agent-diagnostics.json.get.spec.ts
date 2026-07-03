import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifySessionReplayAgentAccess = vi.hoisted(() => vi.fn());
const mockGetSessionReplayTokenizedEvents = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: any) => event.query ?? {},
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../../lib/session-replay-agent-context.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/session-replay-agent-context.js")
  >("../../../lib/session-replay-agent-context.js");
  return {
    ...actual,
    verifySessionReplayAgentAccess: (...args: unknown[]) =>
      mockVerifySessionReplayAgentAccess(...args),
  };
});

vi.mock("../../../lib/session-replay.js", () => ({
  getSessionReplayTokenizedEvents: (...args: unknown[]) =>
    mockGetSessionReplayTokenizedEvents(...args),
}));

import handler from "./agent-diagnostics.json.get";

function makeEvent(query: Record<string, unknown>) {
  return { query } as any;
}

function mockReplayEvents(events: unknown[]) {
  mockGetSessionReplayTokenizedEvents.mockResolvedValue({
    recording: { id: "sr_1" },
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

const consoleErrorEvent = {
  type: 5,
  timestamp: 1200,
  data: {
    tag: "agent-native.console",
    payload: { level: "error", source: "console", message: "boom" },
  },
};

const failedNetworkEvent = {
  type: 5,
  timestamp: 1400,
  data: {
    tag: "agent-native.network",
    payload: {
      api: "fetch",
      method: "GET",
      url: "/api/broken",
      status: 500,
      ok: false,
      durationMs: 12,
    },
  },
};

describe("session replay agent diagnostics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifySessionReplayAgentAccess.mockReturnValue(true);
    mockReplayEvents([
      { type: 4, timestamp: 1000, data: { href: "https://app.example.com" } },
      consoleErrorEvent,
      failedNetworkEvent,
    ]);
  });

  it("requires id and agent access token", async () => {
    const result = await (handler as any)(makeEvent({ id: "sr_1" }));
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 400);
    expect(result).toEqual({ error: "id and agent access token are required" });
  });

  it("rejects invalid agent access tokens with 401", async () => {
    mockVerifySessionReplayAgentAccess.mockReturnValue(false);
    const result = await (handler as any)(
      makeEvent({ id: "sr_1", agent_access: "bad" }),
    );
    expect(mockVerifySessionReplayAgentAccess).toHaveBeenCalledWith(
      "sr_1",
      "bad",
    );
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 401);
    expect(result).toEqual({ error: "Invalid or expired agent access" });
  });

  it("applies no-store agent JSON headers", async () => {
    await (handler as any)(makeEvent({ id: "sr_1", agent_access: "tok" }));
    const headers = mockSetResponseHeader.mock.calls.map((call) => [
      call[1],
      call[2],
    ]);
    expect(headers).toEqual(
      expect.arrayContaining([
        ["Content-Type", "application/json; charset=utf-8"],
        ["X-Content-Type-Options", "nosniff"],
        ["Referrer-Policy", "no-referrer"],
        ["Cache-Control", "private, max-age=0, no-store"],
      ]),
    );
  });

  it("returns bounded console and network diagnostics by default", async () => {
    const result = await (handler as any)(
      makeEvent({ id: "sr_1", agent_access: "tok" }),
    );
    expect(mockGetSessionReplayTokenizedEvents).toHaveBeenCalledWith("sr_1", {
      limit: 10_000,
    });
    expect(result).toMatchObject({
      recordingId: "sr_1",
      kind: "all",
      limit: 200,
      eventsTruncated: false,
      unavailableChunks: 0,
    });
    expect(result.console.entries).toHaveLength(1);
    expect(result.console.errorCount).toBe(1);
    expect(result.network.entries).toHaveLength(1);
    expect(result.network.failedCount).toBe(1);
  });

  it("filters by kind and console level and clamps limit", async () => {
    const consoleOnly = await (handler as any)(
      makeEvent({
        id: "sr_1",
        agent_access: "tok",
        kind: "console",
        level: "warn",
        limit: "9999",
      }),
    );
    expect(consoleOnly.kind).toBe("console");
    expect(consoleOnly.level).toBe("warn");
    expect(consoleOnly.limit).toBe(500);
    expect(consoleOnly.console.entries).toHaveLength(0);
    expect(consoleOnly.console.errorCount).toBe(1);
    expect(consoleOnly).not.toHaveProperty("network");

    const networkOnly = await (handler as any)(
      makeEvent({ id: "sr_1", agent_access: "tok", kind: "network" }),
    );
    expect(networkOnly).not.toHaveProperty("console");
    expect(networkOnly.network.entries).toHaveLength(1);
  });

  it("rejects unknown kind and level values", async () => {
    const badKind = await (handler as any)(
      makeEvent({ id: "sr_1", agent_access: "tok", kind: "everything" }),
    );
    expect(badKind).toEqual({ error: "kind must be console, network, or all" });

    const badLevel = await (handler as any)(
      makeEvent({ id: "sr_1", agent_access: "tok", level: "loud" }),
    );
    expect(badLevel).toEqual({
      error: "level must be log, info, warn, error, or debug",
    });
  });

  it("propagates upstream status codes from event reads", async () => {
    mockGetSessionReplayTokenizedEvents.mockRejectedValue(
      Object.assign(new Error("Session recording not found"), {
        statusCode: 404,
      }),
    );
    const result = await (handler as any)(
      makeEvent({ id: "sr_missing", agent_access: "tok" }),
    );
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(result).toEqual({ error: "Session recording not found" });
  });
});
