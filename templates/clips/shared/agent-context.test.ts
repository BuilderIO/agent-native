import { describe, expect, it } from "vitest";

import {
  buildAgentApiUrls,
  buildRecommendedFrames,
  formatAgentTimestamp,
  safeJsonForHtml,
  toAgentTranscriptSegments,
} from "./agent-context";

describe("agent clip context helpers", () => {
  it("builds shareable agent API URLs with base path and token", () => {
    const urls = buildAgentApiUrls("rec 1", {
      origin: "https://clips.example.com/",
      basePath: "/app/",
      token: "tok",
    });

    expect(urls.contextUrl).toBe(
      "https://clips.example.com/app/api/agent-context.json?id=rec+1&t=tok",
    );
    expect(urls.transcriptUrl).toBe(
      "https://clips.example.com/app/api/agent-transcript.json?id=rec+1&t=tok",
    );
    expect(urls.frameUrlTemplate).toBe(
      "https://clips.example.com/app/api/agent-frame.jpg?id=rec+1&t=tok&atMs={timestampMs}",
    );
    expect(urls.frameUrl(1234)).toBe(
      "https://clips.example.com/app/api/agent-frame.jpg?id=rec+1&t=tok&atMs=1234",
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
