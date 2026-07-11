import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildIdleSkipRanges,
  buildReplayMarkers,
  fetchSessionReplayPlayback,
  filterReplayMarkers,
  normalizeReplayEvents,
  partitionReplayChunkBatches,
  replayDevToolsIssueCount,
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
  it("preserves rrweb structure while blocking captured resource URLs", () => {
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

    const normalized = normalizeReplayEvents(events);
    expect(normalized).toMatchObject([
      {
        data: {
          node: {
            childNodes: [
              {
                attributes: {
                  rel: "stylesheet",
                  href: "about:blank",
                  _cssText: expect.not.stringMatching(/url|@import/i),
                },
              },
              {
                attributes: {
                  src: "about:blank",
                  srcset: "about:blank",
                },
              },
            ],
          },
        },
      },
      {
        data: {
          attributes: [
            {
              attributes: {
                style: expect.not.stringMatching(/url/i),
              },
            },
          ],
        },
      },
    ]);
  });

  it("filters invalid entries and sorts sanitized event copies", () => {
    const later = { type: 3, timestamp: 2000, data: { source: 0 } };
    const earlier = { type: 4, timestamp: 1000, data: { width: 1280 } };
    const normalized = normalizeReplayEvents([later, null, "bad", earlier]);

    expect(normalized).toEqual([earlier, later]);
    expect(normalized[0]).not.toBe(earlier);
    expect(normalized[1]).not.toBe(later);
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
  it("keeps successful network diagnostics out of the event timeline", () => {
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

  it("surfaces failed network diagnostics without exposing successful polling", () => {
    const markers = buildReplayMarkers([
      {
        type: 4,
        timestamp: 1_000,
        data: { href: "https://app.example.test/" },
      },
      {
        type: 5,
        timestamp: 2_000,
        data: {
          tag: "agent-native.network",
          payload: {
            api: "fetch",
            method: "GET",
            url: "https://api.example.test/poll",
            status: 200,
            ok: true,
          },
        },
      },
      {
        type: 5,
        timestamp: 3_000,
        data: {
          tag: "agent-native.network",
          payload: {
            api: "fetch",
            method: "POST",
            url: "https://api.example.test/action",
            status: 0,
            ok: false,
            error: "Failed to fetch",
            durationMs: 42,
          },
        },
      },
    ]);

    expect(markers).toHaveLength(2);
    expect(markers[1]).toMatchObject({
      offsetMs: 2_000,
      kind: "custom",
      label: "Network error",
      detail: "POST https://api.example.test/action",
      severity: "error",
    });
    expect(markers[1]?.fields).toEqual(
      expect.arrayContaining([
        { label: "Status", value: "0" },
        { label: "Error", value: "Failed to fetch" },
      ]),
    );
  });

  it("surfaces scroll, input, click, and focus with normalized offsets", () => {
    const markers = buildReplayMarkers([
      { type: 3, timestamp: 20_000, data: { source: 3, id: 1, x: 0, y: 640 } },
      { type: 3, timestamp: 12_000, data: { source: 5, id: 2, text: "query" } },
      {
        type: 3,
        timestamp: 16_000,
        data: { source: 2, type: 2, id: 3, x: 10, y: 20 },
      },
      { type: 3, timestamp: 18_000, data: { source: 2, type: 5, id: 2 } },
      { type: 3, timestamp: 0, data: { source: 0 } },
      {
        type: 4,
        timestamp: 10_000,
        data: { href: "https://app.example.test/" },
      },
    ]);

    expect(markers.map(({ label, offsetMs }) => ({ label, offsetMs }))).toEqual(
      [
        { label: "Navigate", offsetMs: 0 },
        { label: "Input changed", offsetMs: 2_000 },
        { label: "Click", offsetMs: 6_000 },
        { label: "Focus", offsetMs: 8_000 },
        { label: "Scroll", offsetMs: 10_000 },
      ],
    );
  });

  it("collapses continuous same-element scroll events into one marker", () => {
    const markers = buildReplayMarkers([
      { type: 4, timestamp: 9_000, data: { href: "https://example.test" } },
      { type: 3, timestamp: 10_000, data: { source: 3, id: 1, y: 100 } },
      { type: 3, timestamp: 10_200, data: { source: 3, id: 1, y: 220 } },
      { type: 3, timestamp: 10_800, data: { source: 3, id: 1, y: 480 } },
      { type: 3, timestamp: 12_000, data: { source: 3, id: 1, y: 900 } },
    ]);

    const scrolls = markers.filter((marker) => marker.label === "Scroll");
    expect(scrolls).toHaveLength(2);
    expect(scrolls.map((marker) => marker.offsetMs)).toEqual([1_000, 3_000]);
    expect(scrolls[0]?.fields).toContainEqual({ label: "Y", value: "480" });
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

describe("session replay inactivity ranges", () => {
  it("ignores mutation, mouse-move, and custom diagnostic noise", () => {
    const ranges = buildIdleSkipRanges([
      { type: 4, timestamp: 1_000, data: {} },
      { type: 3, timestamp: 5_000, data: { source: 0 } },
      { type: 3, timestamp: 10_000, data: { source: 1, positions: [] } },
      {
        type: 5,
        timestamp: 15_000,
        data: {
          tag: "agent-native.network",
          payload: { status: 200, ok: true },
        },
      },
      { type: 3, timestamp: 21_000, data: { source: 5, id: 1, text: "q" } },
      { type: 3, timestamp: 25_000, data: { source: 3, id: 1, y: 400 } },
      { type: 3, timestamp: 40_000, data: { source: 0 } },
      {
        type: 5,
        timestamp: 50_000,
        data: {
          tag: "agent-native.network",
          payload: { status: 0, ok: false },
        },
      },
    ]);

    expect(ranges).toEqual([
      { startMs: 1_200, endMs: 18_800 },
      { startMs: 25_200, endMs: 47_800 },
    ]);
  });

  it("treats real click, input, and scroll events as activity", () => {
    const ranges = buildIdleSkipRanges([
      { type: 4, timestamp: 1_000, data: {} },
      { type: 3, timestamp: 10_000, data: { source: 2, type: 2, id: 1 } },
      { type: 3, timestamp: 19_000, data: { source: 5, id: 2, text: "q" } },
      { type: 3, timestamp: 28_000, data: { source: 3, id: 1, y: 400 } },
      { type: 3, timestamp: 33_000, data: { source: 0 } },
    ]);

    expect(ranges).toEqual([
      { startMs: 1_200, endMs: 7_800 },
      { startMs: 10_200, endMs: 16_800 },
      { startMs: 19_200, endMs: 25_800 },
    ]);
  });
});

describe("session replay Dev Tools badge", () => {
  const diagnostics = {
    console: [],
    network: [],
    consoleErrorCount: 33,
    networkFailedCount: 49,
  };

  it("hides partial counts and uses complete replay diagnostics", () => {
    expect(replayDevToolsIssueCount(diagnostics, false)).toBe(0);
    expect(replayDevToolsIssueCount(diagnostics, true)).toBe(82);
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
      if (url.includes("/chunks?")) {
        return jsonResponse({
          chunks: [replayChunkEvents(1, [{ type: 4, timestamp: 1000 }])],
        });
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
      if (url.includes("/chunks?")) {
        return jsonResponse({
          chunks: [
            replayChunkEvents(1, [{ type: 4, timestamp: 1000 }]),
            { ...replayChunkEvents(2, []), unavailable: true },
          ],
        });
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
      if (url.includes("/chunks?")) {
        return jsonResponse({ error: message }, { status });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await expect(fetchSessionReplayPlayback("sr_1")).rejects.toThrow(message);
  });

  it("partitions chunks by count and declared byte limits", () => {
    const byCount = partitionReplayChunkBatches(
      Array.from({ length: 45 }, (_, index) =>
        replayChunkManifest(index, replayChunkPath(index)),
      ),
    );
    expect(byCount.map((batch) => batch.length)).toEqual([20, 20, 5]);

    const byBytes = partitionReplayChunkBatches([
      { ...replayChunkManifest(1, replayChunkPath(1)), byteLength: 3_000_000 },
      { ...replayChunkManifest(2, replayChunkPath(2)), byteLength: 2_000_000 },
    ]);
    expect(byBytes.map((batch) => batch.map((chunk) => chunk.seq))).toEqual([
      [1],
      [2],
    ]);
  });

  it("loads chunk batches three at a time and restores manifest order", async () => {
    const manifestChunks = Array.from({ length: 45 }, (_, index) =>
      replayChunkManifest(index, replayChunkPath(index)),
    );
    let activeBatches = 0;
    let maxActiveBatches = 0;
    let batchRequests = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/manifest")) {
        return jsonResponse({
          recording: recordingSummary(),
          chunks: manifestChunks,
        });
      }
      if (url.includes("/chunks?")) {
        batchRequests += 1;
        activeBatches += 1;
        maxActiveBatches = Math.max(maxActiveBatches, activeBatches);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeBatches -= 1;
        const seqs = new URL(url, "https://analytics.example.test").searchParams
          .get("seqs")!
          .split(",")
          .map(Number)
          .reverse();
        return jsonResponse({
          chunks: seqs.map((seq) => replayChunkEvents(seq, [{ seq }])),
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const playback = await fetchSessionReplayPlayback("sr_1");

    expect(batchRequests).toBe(3);
    expect(maxActiveBatches).toBe(3);
    expect(playback.chunks.map((chunk) => chunk.seq)).toEqual(
      manifestChunks.map((chunk) => chunk.seq),
    );
  });

  it("falls back to a single chunk request only when a batch omits it", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      if (url.includes("/manifest")) {
        return jsonResponse({
          recording: recordingSummary(),
          chunks: [
            replayChunkManifest(1, replayChunkPath(1)),
            replayChunkManifest(2, replayChunkPath(2)),
          ],
        });
      }
      if (url.includes("/chunks?")) {
        return jsonResponse({ chunks: [replayChunkEvents(1, [{ seq: 1 }])] });
      }
      if (url.includes("/chunks/2")) {
        return jsonResponse({ events: [{ seq: 2 }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const playback = await fetchSessionReplayPlayback("sr_1");

    expect(playback.chunks.map((chunk) => chunk.seq)).toEqual([1, 2]);
    expect(seenUrls.filter((url) => url.includes("/chunks/"))).toHaveLength(1);
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

function replayChunkPath(seq: number): string {
  return `/api/session-replay/recordings/sr_1/chunks/${seq}`;
}

function replayChunkEvents(seq: number, events: unknown[]) {
  return {
    seq,
    checksum: `checksum_${seq}`,
    byteLength: 50,
    eventCount: events.length,
    events,
  };
}
