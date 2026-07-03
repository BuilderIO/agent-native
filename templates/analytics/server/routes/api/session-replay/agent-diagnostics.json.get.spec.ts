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

  describe("pagination and time windowing", () => {
    function manyConsoleEvents(count: number) {
      const events: unknown[] = [];
      for (let i = 0; i < count; i += 1) {
        events.push({
          type: 5,
          timestamp: 1000 + i * 10,
          data: {
            tag: "agent-native.console",
            payload: { level: "log", source: "console", message: `log ${i}` },
          },
        });
      }
      return events;
    }

    it("echoes offset and pages results chronologically", async () => {
      mockReplayEvents(manyConsoleEvents(25));

      const page1 = await (handler as any)(
        makeEvent({
          id: "sr_1",
          agent_access: "tok",
          kind: "console",
          limit: "10",
          offset: "0",
        }),
      );
      expect(page1.offset).toBe(0);
      expect(page1.console.entries).toHaveLength(10);
      expect(page1.console.entries[0].message).toBe("log 0");
      expect(page1.console.hasMore).toBe(true);

      const page2 = await (handler as any)(
        makeEvent({
          id: "sr_1",
          agent_access: "tok",
          kind: "console",
          limit: "10",
          offset: "10",
        }),
      );
      expect(page2.offset).toBe(10);
      expect(page2.console.entries[0].message).toBe("log 10");
      expect(page2.console.hasMore).toBe(true);

      const page3 = await (handler as any)(
        makeEvent({
          id: "sr_1",
          agent_access: "tok",
          kind: "console",
          limit: "10",
          offset: "20",
        }),
      );
      expect(page3.offset).toBe(20);
      expect(page3.console.entries).toHaveLength(5);
      expect(page3.console.hasMore).toBe(false);

      // Pages union to the full 25-entry set with no overlap.
      const union = [
        ...page1.console.entries,
        ...page2.console.entries,
        ...page3.console.entries,
      ].map((entry: any) => entry.message);
      expect(union).toHaveLength(25);
      expect(new Set(union).size).toBe(25);
    });

    it("reads enough replay events to reach later diagnostics pages", async () => {
      mockReplayEvents(manyConsoleEvents(25));

      await (handler as any)(
        makeEvent({
          id: "sr_1",
          agent_access: "tok",
          kind: "console",
          limit: "10",
          offset: "12000",
        }),
      );

      expect(mockGetSessionReplayTokenizedEvents).toHaveBeenLastCalledWith(
        "sr_1",
        { limit: 12010 },
      );
    });

    it("echoes fromMs/toMs and windows the response, with totals reflecting the window", async () => {
      mockReplayEvents(manyConsoleEvents(10));
      // offsetMs values: 0,10,20,...,90 (startedAt = 1000)

      const result = await (handler as any)(
        makeEvent({
          id: "sr_1",
          agent_access: "tok",
          kind: "console",
          fromMs: "20",
          toMs: "50",
        }),
      );

      expect(result.fromMs).toBe(20);
      expect(result.toMs).toBe(50);
      expect(result.console.entries.map((entry: any) => entry.message)).toEqual(
        ["log 2", "log 3", "log 4", "log 5"],
      );
      expect(result.console.total).toBe(4);
      expect(result.console.hasMore).toBe(false);
      expect(mockGetSessionReplayTokenizedEvents).toHaveBeenLastCalledWith(
        "sr_1",
        { limit: 100_000 },
      );
    });

    it("rejects fromMs greater than toMs with 400", async () => {
      const result = await (handler as any)(
        makeEvent({
          id: "sr_1",
          agent_access: "tok",
          fromMs: "500",
          toMs: "100",
        }),
      );
      expect(mockSetResponseStatus).toHaveBeenCalledWith(
        expect.anything(),
        400,
      );
      expect(result).toEqual({
        error: "fromMs must be less than or equal to toMs",
      });
    });

    it("rejects a negative or non-numeric offset with 400", async () => {
      const negative = await (handler as any)(
        makeEvent({ id: "sr_1", agent_access: "tok", offset: "-5" }),
      );
      expect(mockSetResponseStatus).toHaveBeenCalledWith(
        expect.anything(),
        400,
      );
      expect(negative).toEqual({
        error: "offset must be a non-negative integer",
      });

      mockSetResponseStatus.mockClear();
      const nonNumeric = await (handler as any)(
        makeEvent({ id: "sr_1", agent_access: "tok", offset: "abc" }),
      );
      expect(mockSetResponseStatus).toHaveBeenCalledWith(
        expect.anything(),
        400,
      );
      expect(nonNumeric).toEqual({
        error: "offset must be a non-negative integer",
      });
    });

    it("rejects negative or non-numeric fromMs/toMs with 400", async () => {
      const badFrom = await (handler as any)(
        makeEvent({ id: "sr_1", agent_access: "tok", fromMs: "-1" }),
      );
      expect(badFrom).toEqual({
        error: "fromMs must be a non-negative integer",
      });

      const badTo = await (handler as any)(
        makeEvent({ id: "sr_1", agent_access: "tok", toMs: "nope" }),
      );
      expect(badTo).toEqual({
        error: "toMs must be a non-negative integer",
      });
    });

    it("does not echo offset/fromMs/toMs when not provided and keeps default errors-first behavior", async () => {
      const events: unknown[] = [];
      for (let i = 0; i < 5; i += 1) {
        events.push({
          type: 5,
          timestamp: 1000 + i,
          data: {
            tag: "agent-native.console",
            payload: { level: "log", source: "console", message: `log ${i}` },
          },
        });
      }
      events.push(consoleErrorEvent);
      mockReplayEvents(events);

      const result = await (handler as any)(
        makeEvent({ id: "sr_1", agent_access: "tok", kind: "console" }),
      );

      expect(result).not.toHaveProperty("offset");
      expect(result).not.toHaveProperty("fromMs");
      expect(result).not.toHaveProperty("toMs");
      // Default (no paging params) behavior is unchanged: errors-first is
      // exercised in the builder spec; here we just confirm the route still
      // returns the full unbounded set with no page params echoed.
      expect(result.console.entries.length).toBeGreaterThan(0);
    });
  });
});
