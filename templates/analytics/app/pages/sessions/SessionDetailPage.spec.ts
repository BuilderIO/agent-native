import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSessionReplayPlayback,
  replayPayloadEvents,
  replayViewportDimensions,
  sanitizeReplayEvents,
} from "./SessionDetailPage";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("session replay sanitization", () => {
  it("strips live-loading resource attributes from replay snapshots", () => {
    const [event] = sanitizeReplayEvents([
      {
        type: 2,
        timestamp: 1000,
        data: {
          node: {
            type: 2,
            tagName: "body",
            attributes: { class: "page" },
            childNodes: [
              {
                type: 2,
                tagName: "img",
                attributes: {
                  alt: "Hero",
                  src: "https://cdn.example.test/hero.png",
                  srcset: "https://cdn.example.test/hero-2x.png 2x",
                  style:
                    "background-image: url(https://cdn.example.test/bg.png)",
                  onclick: "steal()",
                },
                childNodes: [],
              },
              {
                type: 2,
                tagName: "a",
                attributes: {
                  href: "https://example.test/account",
                  title: "Account",
                },
                childNodes: [],
              },
              {
                type: 2,
                tagName: "script",
                attributes: { src: "https://cdn.example.test/app.js" },
                childNodes: [],
              },
            ],
          },
        },
      },
    ]);

    expect(event?.data.node.childNodes[0].attributes).toEqual({
      alt: "Hero",
      style: "background-image: none",
    });
    expect(event?.data.node.childNodes[1].attributes).toEqual({
      title: "Account",
    });
    expect(event?.data.node.childNodes[2]).toMatchObject({
      tagName: "noscript",
      attributes: {},
      childNodes: [],
    });
  });

  it("strips live-loading attributes from replay mutation patches", () => {
    const [event] = sanitizeReplayEvents([
      {
        type: 3,
        timestamp: 1000,
        data: {
          source: 0,
          attributes: [
            {
              id: 1,
              attributes: {
                class: "avatar",
                src: "https://cdn.example.test/avatar.png",
                style: "color: red",
                href: "https://example.test/profile",
              },
            },
          ],
          adds: [
            {
              parentId: 1,
              nextId: null,
              node: {
                type: 2,
                tagName: "iframe",
                attributes: {
                  src: "https://evil.example.test/frame",
                  srcdoc: "<script>alert(1)</script>",
                  title: "Preview",
                },
                childNodes: [],
              },
            },
          ],
        },
      },
    ]);

    expect(event?.data.attributes[0].attributes).toEqual({
      class: "avatar",
      style: "color: red",
    });
    expect(event?.data.adds[0].node.attributes).toEqual({ title: "Preview" });
  });

  it("keeps replay styles while stripping stylesheet network fetches", () => {
    const [event] = sanitizeReplayEvents([
      {
        type: 2,
        timestamp: 1000,
        data: {
          node: {
            type: 2,
            tagName: "body",
            attributes: {},
            childNodes: [
              {
                type: 2,
                tagName: "style",
                attributes: { nonce: "replay" },
                childNodes: [
                  {
                    type: 3,
                    textContent:
                      '@import "https://evil.example.test/app.css"; body { background: url(https://evil.example.test/bg.png); }',
                  },
                ],
              },
            ],
          },
        },
      },
    ]);

    const styleNode = event?.data.node.childNodes[0];
    expect(styleNode).toMatchObject({
      tagName: "style",
      attributes: { nonce: "replay" },
    });
    expect(styleNode.childNodes[0].textContent).toContain("background: none");
    expect(styleNode.childNodes[0].textContent).not.toMatch(/@import|url\(/i);
  });

  it("keeps rrweb inlined stylesheet text without live resource loads", () => {
    const [fullSnapshot, mutation] = sanitizeReplayEvents([
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
                tagName: "head",
                attributes: {},
                childNodes: [
                  {
                    type: 2,
                    tagName: "link",
                    attributes: {
                      rel: "stylesheet",
                      href: "https://cdn.example.test/app.css",
                      _cssText:
                        '@import "https://cdn.example.test/fonts.css"; body { background: url(https://cdn.example.test/bg.png); color: red; }',
                    },
                    childNodes: [],
                  },
                ],
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
                _cssText:
                  '.loaded { background-image: url("https://cdn.example.test/loaded.png"); color: blue; }',
              },
            },
          ],
        },
      },
    ]);

    const linkAttributes =
      fullSnapshot?.data.node.childNodes[0].childNodes[0].attributes;
    expect(linkAttributes).toEqual({
      rel: "stylesheet",
      _cssText: " body { background: none; color: red; }",
    });
    expect(mutation?.data.attributes[0].attributes).toEqual({
      _cssText: ".loaded { background-image: none; color: blue; }",
    });
  });

  it("keeps safe embedded CSS urls while stripping live replay resource loads", () => {
    const [event] = sanitizeReplayEvents([
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
                tagName: "head",
                attributes: {},
                childNodes: [
                  {
                    type: 2,
                    tagName: "link",
                    attributes: {
                      rel: "stylesheet",
                      _cssText:
                        ".safe { cursor: url(data:image/png;base64,abc), auto; mask: url('#icon'); background: url(blob:https://app.example.test/asset); border-image: url(https://cdn.example.test/border.png); }",
                    },
                    childNodes: [],
                  },
                ],
              },
            ],
          },
        },
      },
    ]);

    const linkAttributes =
      event?.data.node.childNodes[0].childNodes[0].attributes;
    expect(linkAttributes?._cssText).toContain(
      "url(data:image/png;base64,abc)",
    );
    expect(linkAttributes?._cssText).toContain("url('#icon')");
    expect(linkAttributes?._cssText).toContain(
      "url(blob:https://app.example.test/asset)",
    );
    expect(linkAttributes?._cssText).toContain("border-image: none");
    expect(linkAttributes?._cssText).not.toContain("https://cdn.example.test");
  });

  it("strips replay text mutations that can inject stylesheet fetches", () => {
    const [event] = sanitizeReplayEvents([
      {
        type: 3,
        timestamp: 1000,
        data: {
          source: 0,
          texts: [
            {
              id: 10,
              value:
                '@import "https://evil.example.test/app.css"; .x { background: url(https://evil.example.test/bg.png); }',
            },
            { id: 11, value: "Normal page copy" },
          ],
        },
      },
    ]);

    expect(event?.data.texts[0].value).toBe(" .x { background: none; }");
    expect(event?.data.texts[1].value).toBe("Normal page copy");
  });

  it("derives viewport dimensions from the first replay meta event", () => {
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

describe("session replay chunk loading", () => {
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
