import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildReplayMarkers,
  fetchSessionReplayPlayback,
  filterReplayMarkers,
  normalizeReplayEvents,
  replayPayloadEvents,
  replayViewportDimensions,
} from "./SessionDetailPage";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("session replay event normalization", () => {
  it("preserves rrweb DOM, stylesheet, resource, and mutation payloads", () => {
    const events = [
      {
        type: 2,
        timestamp: 1000,
        data: {
          node: {
            type: 2,
            tagName: "html",
            attributes: {},
            childNodes: [
              {
                type: 2,
                tagName: "link",
                attributes: {
                  rel: "stylesheet",
                  href: "https://cdn.example.test/app.css",
                  _cssText:
                    '@import "https://cdn.example.test/fonts.css"; body { background: url(https://cdn.example.test/bg.png); }',
                },
                childNodes: [],
              },
              {
                type: 2,
                tagName: "img",
                attributes: {
                  src: "https://cdn.example.test/hero.png",
                  srcset: "https://cdn.example.test/hero-2x.png 2x",
                },
                childNodes: [],
              },
            ],
          },
        },
      },
      {
        type: 3,
        timestamp: 1100,
        data: {
          source: 0,
          attributes: [
            {
              id: 10,
              attributes: {
                style:
                  "background-image: url(https://cdn.example.test/loaded.png)",
              },
            },
          ],
        },
      },
    ];

    expect(normalizeReplayEvents(events)).toEqual(events);
  });

  it("filters invalid entries and sorts events without cloning payloads", () => {
    const later = { type: 3, timestamp: 2000, data: { source: 0 } };
    const earlier = { type: 4, timestamp: 1000, data: { width: 1280 } };
    const normalized = normalizeReplayEvents([later, null, "bad", earlier]);

    expect(normalized).toEqual([earlier, later]);
    expect(normalized[0]).toBe(earlier);
    expect(normalized[1]).toBe(later);
  });

  it("derives viewport dimensions from the latest meta or resize event", () => {
    expect(
      replayViewportDimensions([
        { type: 4, timestamp: 1000, data: { width: 1280.4, height: 720.2 } },
      ]),
    ).toEqual({ width: 1280, height: 720 });
    expect(
      replayViewportDimensions([
        { type: 4, timestamp: 1000, data: { width: 0, height: 720 } },
      ]),
    ).toBeNull();
    expect(
      replayViewportDimensions([
        { type: 4, timestamp: 1000, data: { width: 4800, height: 900 } },
        { type: 4, timestamp: 1500, data: { width: 1440, height: 900 } },
      ]),
    ).toEqual({ width: 1440, height: 900 });
    expect(
      replayViewportDimensions([
        { type: 4, timestamp: 1000, data: { width: 1440, height: 900 } },
        {
          type: 3,
          timestamp: 1600,
          data: { source: 4, width: 1280, height: 800 },
        },
      ]),
    ).toEqual({ width: 1280, height: 800 });
    // Raw Meta dimensions are kept as-is for CSS fit-to-stage only.
    expect(
      replayViewportDimensions([
        { type: 4, timestamp: 1000, data: { width: 4800, height: 900 } },
      ]),
    ).toEqual({ width: 4800, height: 900 });
    expect(
      replayViewportDimensions([
        { type: 4, timestamp: 1000, data: { width: 2560, height: 1080 } },
      ]),
    ).toEqual({ width: 2560, height: 1080 });
    expect(
      replayViewportDimensions([
        { type: 4, timestamp: 1000, data: { width: 3840, height: 1080 } },
      ]),
    ).toEqual({ width: 3840, height: 1080 });
  });

  it("normalizes scoped chunk route payloads into replay event arrays", () => {
    const events = [{ type: 4, timestamp: 1000 }];

    expect(replayPayloadEvents(events)).toEqual(events);
    expect(replayPayloadEvents({ events })).toEqual(events);
    expect(replayPayloadEvents(null)).toEqual([]);
    expect(replayPayloadEvents({ type: 5, timestamp: 2000 })).toEqual([
      { type: 5, timestamp: 2000 },
    ]);
  });
});

describe("session replay timeline markers", () => {
  it("keeps network diagnostics out of the event timeline", () => {
    const markers = buildReplayMarkers([
      {
        type: 4,
        timestamp: 1_000,
        data: { width: 1280, height: 720, href: "https://app.example.test/" },
      },
      {
        type: 5,
        timestamp: 1_500,
        data: {
          tag: "agent-native.network",
          payload: {
            api: "fetch",
            method: "GET",
            url: "https://api.example.test/noisy",
            status: 200,
            ok: true,
          },
        },
      },
      {
        type: 3,
        timestamp: 2_000,
        data: { source: 2, type: 2, id: 7, x: 24, y: 32 },
      },
    ]);

    expect(markers.map((marker) => marker.kind)).toEqual([
      "navigation",
      "click",
    ]);
  });

  it("keeps only warning and error console diagnostics in the event timeline", () => {
    const markers = buildReplayMarkers([
      { type: 4, timestamp: 1_000, data: { width: 1280, height: 720 } },
      {
        type: 5,
        timestamp: 1_100,
        data: {
          tag: "agent-native.console",
          payload: { level: "log", message: "routine" },
        },
      },
      {
        type: 5,
        timestamp: 1_200,
        data: {
          tag: "agent-native.console",
          payload: { level: "error", message: "boom" },
        },
      },
    ]);

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      kind: "console",
      severity: "error",
      detail: "boom",
    });
  });

  it("filters timeline markers by label and detail text", () => {
    const markers = buildReplayMarkers([
      {
        type: 4,
        timestamp: 1_000,
        data: { width: 1280, height: 720, href: "https://app.example.test/" },
      },
      {
        type: 3,
        timestamp: 2_000,
        data: { source: 2, type: 2, id: 7, x: 24, y: 32 },
      },
    ]);
    expect(filterReplayMarkers(markers, "navigate").map((m) => m.kind)).toEqual(
      ["navigation"],
    );
    expect(filterReplayMarkers(markers, "x 24").map((m) => m.kind)).toEqual([
      "click",
    ]);
    expect(filterReplayMarkers(markers, "missing")).toEqual([]);
  });
});

describe("session replay chunk loading", () => {
  it("keeps copied agent access tokens on manifest and chunk fetches", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://analytics.example.test",
        pathname: "/sessions/sr_1",
        search: "?agent_access=agent-token",
      },
    });
    vi.stubGlobal("location", {
      origin: "https://analytics.example.test",
      pathname: "/sessions/sr_1",
      search: "?agent_access=agent-token",
    });
    const seenUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      if (url.includes("/manifest")) {
        return jsonResponse({
          recording: recordingSummary(),
          chunks: [
            replayChunkManifest(
              1,
              "/api/session-replay/recordings/sr_1/chunks/1",
            ),
          ],
        });
      }
      if (url.includes("/chunks/1")) {
        return jsonResponse({ events: [{ type: 4, timestamp: 1000 }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await fetchSessionReplayPlayback("sr_1", {
      agentAccessToken: "agent-token",
    });

    expect(seenUrls).toHaveLength(2);
    expect(seenUrls[0]).toContain("agent_access=agent-token");
    expect(seenUrls[1]).toContain("agent_access=agent-token");
  });

  it("keeps explicitly unavailable chunks as partial replay segments", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/manifest")) {
        return jsonResponse({
          recording: recordingSummary(),
          chunks: [
            replayChunkManifest(
              1,
              "/api/session-replay/recordings/sr_1/chunks/1",
            ),
            replayChunkManifest(
              2,
              "/api/session-replay/recordings/sr_1/chunks/2",
            ),
          ],
        });
      }
      if (url.includes("/chunks/1")) {
        return jsonResponse({ events: [{ type: 4, timestamp: 1000 }] });
      }
      if (url.includes("/chunks/2")) {
        return jsonResponse(
          { error: "Session replay chunk is unavailable" },
          { status: 404 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const playback = await fetchSessionReplayPlayback("sr_1");

    expect(playback.eventCount).toBe(1);
    expect(playback.unavailableChunks).toBe(1);
    expect(playback.chunks[0].events).toEqual([{ type: 4, timestamp: 1000 }]);
    expect(playback.chunks[1]).toMatchObject({
      seq: 2,
      events: [],
      unavailable: true,
    });
  });

  it.each([
    [403, "Forbidden"],
    [500, "Replay storage failed"],
  ])("rejects chunk fetch failures with HTTP %s", async (status, message) => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/manifest")) {
        return jsonResponse({
          recording: recordingSummary(),
          chunks: [
            replayChunkManifest(
              1,
              "/api/session-replay/recordings/sr_1/chunks/1",
            ),
          ],
        });
      }
      if (url.includes("/chunks/1")) {
        return jsonResponse({ error: message }, { status });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await expect(fetchSessionReplayPlayback("sr_1")).rejects.toThrow(message);
  });
});

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function recordingSummary() {
  return {
    id: "sr_1",
    clientRecordingId: "client_sr_1",
    sessionId: "sess_1",
    userId: "user_1",
    anonymousId: null,
    userKey: "user@example.test",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    durationMs: 60_000,
    chunkCount: 2,
    eventCount: 1,
    totalBytes: 100,
    pageCount: 1,
    errorCount: 0,
    rageClickCount: 0,
    privacyMode: "default",
    firstUrl: "https://example.test/",
    lastUrl: "https://example.test/",
    path: "/",
    hostname: "example.test",
    referrer: null,
    app: "Analytics",
    template: "analytics",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    lastIngestedAt: "2026-01-01T00:01:00.000Z",
  };
}

function replayChunkManifest(seq: number, bytesPath: string) {
  return {
    seq,
    checksum: `checksum_${seq}`,
    byteLength: 50,
    eventCount: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:10.000Z",
    bytesPath,
  };
}
