import { describe, expect, it } from "vitest";

import {
  extractReplayDiagnostics,
  filterConsoleEntries,
  filterNetworkEntries,
  formatOffsetClock,
  latestEntryIndexAt,
  middleTruncate,
  networkDisplayUrl,
} from "./session-replay-devtools";
import { sanitizeReplayEvents } from "./SessionDetailPage";

const REPLAY_START = 1_000_000;

function consoleEvent(offsetMs: number, payload: Record<string, unknown>) {
  return {
    type: 5,
    timestamp: REPLAY_START + offsetMs,
    data: { tag: "agent-native.console", payload },
  };
}

function networkEvent(offsetMs: number, payload: Record<string, unknown>) {
  return {
    type: 5,
    timestamp: REPLAY_START + offsetMs,
    data: { tag: "agent-native.network", payload },
  };
}

const baseEvents = [
  { type: 4, timestamp: REPLAY_START, data: { width: 1280, height: 720 } },
  { type: 2, timestamp: REPLAY_START + 10, data: { node: {} } },
];

describe("extractReplayDiagnostics", () => {
  it("extracts console and network entries with offsets from the first event", () => {
    const diagnostics = extractReplayDiagnostics([
      ...baseEvents,
      consoleEvent(1_500, {
        level: "error",
        source: "window-error",
        message: "boom",
        stack: "Error: boom\n  at app.js:1",
        repeat: 3,
      }),
      networkEvent(2_500, {
        api: "xhr",
        method: "post",
        url: "https://api.example.test/v1/things?limit=5",
        status: 500,
        ok: false,
        durationMs: 123.6,
        error: "Internal Server Error",
      }),
    ]);

    expect(diagnostics.console).toHaveLength(1);
    expect(diagnostics.console[0]).toMatchObject({
      offsetMs: 1_500,
      level: "error",
      source: "window-error",
      message: "boom",
      repeat: 3,
    });
    expect(diagnostics.network).toHaveLength(1);
    expect(diagnostics.network[0]).toMatchObject({
      offsetMs: 2_500,
      api: "xhr",
      method: "POST",
      status: 500,
      failed: true,
      durationMs: 124,
    });
    expect(diagnostics.consoleErrorCount).toBe(1);
    expect(diagnostics.networkFailedCount).toBe(1);
  });

  it("ignores non-diagnostics custom events and malformed payloads", () => {
    const diagnostics = extractReplayDiagnostics([
      ...baseEvents,
      { type: 5, timestamp: REPLAY_START + 100, data: { tag: "other" } },
      {
        type: 5,
        timestamp: REPLAY_START + 200,
        data: { tag: "agent-native.console", payload: null },
      },
      { type: 5, timestamp: 0, data: { tag: "agent-native.console" } },
      consoleEvent(300, { level: "nope", source: "nope", message: "hello" }),
    ]);

    expect(diagnostics.console).toHaveLength(1);
    expect(diagnostics.console[0]).toMatchObject({
      level: "log",
      source: "console",
      message: "hello",
      repeat: 1,
    });
    expect(diagnostics.network).toHaveLength(0);
  });

  it("still sees diagnostics events after replay sanitization", () => {
    const sanitized = sanitizeReplayEvents([
      ...baseEvents,
      consoleEvent(500, {
        level: "warn",
        source: "console",
        message: "careful",
      }),
      networkEvent(700, {
        api: "fetch",
        method: "GET",
        url: "https://api.example.test/ping",
        status: 200,
        ok: true,
        durationMs: 20,
      }),
    ]);

    const diagnostics = extractReplayDiagnostics(sanitized);
    expect(diagnostics.console).toHaveLength(1);
    expect(diagnostics.console[0].message).toBe("careful");
    expect(diagnostics.network).toHaveLength(1);
    expect(diagnostics.network[0].offsetMs).toBe(700);
  });

  it("surfaces responseBody when present and leaves it undefined otherwise", () => {
    const diagnostics = extractReplayDiagnostics([
      ...baseEvents,
      networkEvent(1_200, {
        api: "fetch",
        method: "GET",
        url: "https://api.example.test/v1/broken",
        status: 500,
        ok: false,
        durationMs: 80,
        error: "Internal Server Error",
        responseBody: '{"error":"boom"}',
      }),
      networkEvent(1_800, {
        api: "fetch",
        method: "GET",
        url: "https://api.example.test/v1/ok",
        status: 200,
        ok: true,
        durationMs: 15,
      }),
    ]);

    expect(diagnostics.network[0].responseBody).toBe('{"error":"boom"}');
    expect(diagnostics.network[1].responseBody).toBeUndefined();
  });

  it("marks status 0 requests as failed and sorts entries by offset", () => {
    const diagnostics = extractReplayDiagnostics([
      ...baseEvents,
      networkEvent(4_000, {
        api: "fetch",
        method: "GET",
        url: "https://api.example.test/late",
        status: 200,
        ok: true,
        durationMs: 40,
      }),
      networkEvent(1_000, {
        api: "fetch",
        method: "GET",
        url: "https://api.example.test/dropped",
        status: 0,
        ok: false,
        durationMs: 10,
        error: "Failed to fetch",
      }),
    ]);

    expect(diagnostics.network.map((entry) => entry.offsetMs)).toEqual([
      1_000, 4_000,
    ]);
    expect(diagnostics.network[0].failed).toBe(true);
    expect(diagnostics.network[1].failed).toBe(false);
    expect(diagnostics.networkFailedCount).toBe(1);
  });
});

describe("filterConsoleEntries", () => {
  const entries = extractReplayDiagnostics([
    ...baseEvents,
    consoleEvent(100, { level: "debug", source: "console", message: "dbg" }),
    consoleEvent(200, { level: "warn", source: "console", message: "careful" }),
    consoleEvent(300, {
      level: "error",
      source: "unhandledrejection",
      message: "rejected promise",
      args: ["TypeError: x is not a function"],
    }),
  ]).console;

  it("buckets debug under the log chip", () => {
    expect(filterConsoleEntries(entries, "log", "")).toHaveLength(1);
    expect(filterConsoleEntries(entries, "log", "")[0].message).toBe("dbg");
  });

  it("matches search text against message and args", () => {
    expect(filterConsoleEntries(entries, "all", "CAREFUL")).toHaveLength(1);
    expect(filterConsoleEntries(entries, "all", "typeerror")).toHaveLength(1);
    expect(filterConsoleEntries(entries, "error", "typeerror")).toHaveLength(1);
    expect(filterConsoleEntries(entries, "warn", "typeerror")).toHaveLength(0);
  });
});

describe("filterNetworkEntries", () => {
  const entries = extractReplayDiagnostics([
    ...baseEvents,
    networkEvent(100, {
      api: "fetch",
      method: "GET",
      url: "https://api.example.test/ok",
      status: 200,
      ok: true,
      durationMs: 12,
    }),
    networkEvent(200, {
      api: "xhr",
      method: "POST",
      url: "https://api.example.test/save",
      status: 422,
      ok: false,
      durationMs: 30,
    }),
  ]).network;

  it("filters by kind and failure", () => {
    expect(filterNetworkEntries(entries, "fetch", "")).toHaveLength(1);
    expect(filterNetworkEntries(entries, "xhr", "")).toHaveLength(1);
    expect(filterNetworkEntries(entries, "failed", "")).toHaveLength(1);
    expect(filterNetworkEntries(entries, "failed", "")[0].status).toBe(422);
  });

  it("matches search text against URL, method, and status", () => {
    expect(filterNetworkEntries(entries, "all", "/save")).toHaveLength(1);
    expect(filterNetworkEntries(entries, "all", "post")).toHaveLength(1);
    expect(filterNetworkEntries(entries, "all", "422")).toHaveLength(1);
    expect(filterNetworkEntries(entries, "all", "nomatch")).toHaveLength(0);
  });
});

describe("latestEntryIndexAt", () => {
  const entries = [
    { offsetMs: 1_000 },
    { offsetMs: 5_000 },
    { offsetMs: 9_000 },
  ];

  it("returns the latest entry at or before the playback time", () => {
    expect(latestEntryIndexAt(entries, 0)).toBe(-1);
    expect(latestEntryIndexAt(entries, 1_000)).toBe(0);
    expect(latestEntryIndexAt(entries, 4_700)).toBe(0);
    // 250ms tolerance mirrors the timeline's active-marker window.
    expect(latestEntryIndexAt(entries, 4_800)).toBe(1);
    expect(latestEntryIndexAt(entries, 5_100)).toBe(1);
    expect(latestEntryIndexAt(entries, 60_000)).toBe(2);
    expect(latestEntryIndexAt([], 60_000)).toBe(-1);
  });
});

describe("display helpers", () => {
  it("middle-truncates long values and keeps short values intact", () => {
    expect(middleTruncate("short", 10)).toBe("short");
    const truncated = middleTruncate("a".repeat(40) + "/end-of-url", 24);
    expect(truncated).toHaveLength(24);
    expect(truncated).toContain("…");
    expect(truncated.endsWith("of-url")).toBe(true);
  });

  it("prefers path + query for parseable URLs", () => {
    expect(networkDisplayUrl("https://api.example.test/v1/items?limit=5")).toBe(
      "/v1/items?limit=5",
    );
    expect(networkDisplayUrl("not a url")).toBe("not a url");
  });

  it("formats offsets as clock strings", () => {
    expect(formatOffsetClock(0)).toBe("0:00");
    expect(formatOffsetClock(65_000)).toBe("1:05");
    expect(formatOffsetClock(3_725_000)).toBe("1:02:05");
  });
});
