import { describe, expect, it } from "vitest";

import {
  agentAccessTokenResourceId,
  buildAgentApiUrls,
  buildAgentDiscoveryPayload,
  buildAgentHttpToolManifest,
  buildRecommendedFrames,
  formatAgentTimestamp,
  safeJsonForHtml,
  toAgentTranscriptSegments,
} from "./agent-context";

describe("agent clip context helpers", () => {
  it("tells an agent to wait when a shared clip is still uploading", () => {
    const payload = buildAgentDiscoveryPayload({
      recordingId: "rec-1",
      title: "Clip",
      status: "uploading",
      agentContextUrl:
        "https://clips.example.com/api/agent-context.json?id=rec-1",
    });

    expect(payload.recordingStatus).toBe("uploading");
    expect(payload.agentReadiness).toMatchObject({
      state: "preparing",
      retryAfterSeconds: 15,
    });
    expect(payload.instructions).toMatch(/still uploading/i);
    expect(payload.instructions).toMatch(/wait 15 seconds/i);
    expect(payload.instructions).not.toMatch(/JPEG frame URLs/i);
    expect(payload.webmcp.tools.map((tool) => tool.name)).toEqual([
      "clips-get-context",
      "clips-get-transcript",
      "clips-get-frame",
    ]);
    expect(payload.http.tools.map((tool) => tool.name)).toEqual([
      "clips-get-context",
      "clips-get-transcript",
    ]);
  });

  it("scopes private agent access tokens separately from media tokens", () => {
    expect(agentAccessTokenResourceId("rec-1")).toBe(
      "clip-agent-context:rec-1",
    );
  });

  it("keeps browser-independent HTTP access first-class", () => {
    const payload = buildAgentDiscoveryPayload({
      recordingId: "rec-1",
      title: "Clip",
      status: "ready",
      agentContextUrl:
        "https://clips.example.com/api/agent-context.json?id=rec-1",
    });

    expect(payload.instructions).toContain("this works without a browser");
    expect(payload.webmcp.instructions).toContain(
      "For browser-independent access from any HTTP client",
    );
    expect(payload.webmcp.instructions).toContain(
      "For a complete transcript, use the HTTP apis.transcript URL",
    );
    expect(payload.webmcp.instructions).toContain("bounded read-only access");
    expect(payload.webmcp.instructions).toContain(
      "its sourceUrl points to the HTTP transcript",
    );
    expect(payload.http.tools).toMatchObject([
      {
        name: "clips-get-context",
        method: "GET",
        endpoint: "https://clips.example.com/api/agent-context.json?id=rec-1",
        responseType: "application/json",
      },
      {
        name: "clips-get-transcript",
        method: "GET",
        endpoint:
          "https://clips.example.com/api/agent-transcript.json?id=rec-1",
        responseType: "application/json",
      },
      {
        name: "clips-get-frame",
        method: "GET",
        endpoint:
          "https://clips.example.com/api/agent-frame.jpg?id=rec-1&atMs={timestampMs}",
        responseType: "image/jpeg",
      },
    ]);
  });

  it("describes the same clip tools as browser-independent fetch endpoints", () => {
    const manifest = buildAgentHttpToolManifest({
      contextUrl: "https://clips.example.com/api/agent-context.json?id=rec-1",
      transcriptUrl:
        "https://clips.example.com/api/agent-transcript.json?id=rec-1",
      frameUrlTemplate:
        "https://clips.example.com/api/agent-frame.jpg?id=rec-1&atMs={timestampMs}",
    });

    expect(manifest).toMatchObject({
      schema_version: "v1",
      browserRequired: false,
    });
    expect(manifest.tools).toHaveLength(3);
    expect(manifest.tools[1].parameters).toEqual(manifest.tools[1].inputSchema);
  });

  it("builds shareable agent API URLs with base path and token", () => {
    const urls = buildAgentApiUrls("rec 1", {
      origin: "https://clips.example.com/",
      basePath: "/app/",
      token: "tok",
    });

    expect(urls.contextUrl).toBe(
      "https://clips.example.com/app/api/agent-context.json?id=rec+1&agent_access=tok",
    );
    expect(urls.transcriptUrl).toBe(
      "https://clips.example.com/app/api/agent-transcript.json?id=rec+1&agent_access=tok",
    );
    expect(urls.frameUrlTemplate).toBe(
      "https://clips.example.com/app/api/agent-frame.jpg?id=rec+1&agent_access=tok&atMs={timestampMs}",
    );
    expect(urls.frameUrl(1234)).toBe(
      "https://clips.example.com/app/api/agent-frame.jpg?id=rec+1&agent_access=tok&atMs=1234",
    );
  });

  it("formats timestamped transcript segments for agents", () => {
    expect(formatAgentTimestamp(80_000)).toBe("1:20");
    expect(formatAgentTimestamp(3_723_000)).toBe("1:02:03");

    expect(
      toAgentTranscriptSegments([
        { startMs: 80_000, endMs: 82_000, text: "Look at this", source: "mic" },
      ]),
    ).toEqual([
      {
        startMs: 80_000,
        endMs: 82_000,
        timestamp: "1:20",
        range: "1:20-1:22",
        text: "Look at this",
        source: "mic",
      },
    ]);
  });

  it("recommends frames from opening, chapters, transcript, and duration", () => {
    const frames = buildRecommendedFrames({
      durationMs: 120_000,
      chapters: [{ startMs: 30_000, title: "Demo" }],
      segments: [
        { startMs: 31_000, endMs: 33_000, text: "too close" },
        { startMs: 75_000, endMs: 80_000, text: "important screen" },
      ],
      maxFrames: 6,
    });

    expect(frames.map((frame) => frame.atMs)).toEqual([
      0, 30_000, 60_000, 75_000, 90_000,
    ]);
    expect(frames[1].reason).toBe("chapter: Demo");
    expect(frames[3].reason).toBe("transcript: important screen");
  });

  it("escapes JSON embedded in SSR HTML", () => {
    expect(safeJsonForHtml({ value: "</script>&" })).toBe(
      '{"value":"\\u003c/script\\u003e\\u0026"}',
    );
  });
});
