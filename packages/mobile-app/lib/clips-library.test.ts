import { describe, expect, it, vi } from "vitest";

vi.mock("./clips-api", () => ({
  callClipsAction: vi.fn(),
  getClipsBaseUrl: () => "https://clips.agent-native.com",
  normalizeClipsApiError: (error: unknown) => error,
}));

import {
  buildNativeClipSharePayload,
  buildPrivacySafeClipShareUrl,
  formatClipDate,
  formatClipDuration,
  normalizeClipSummary,
  parseClipsSearchResponse,
  parseCommentReactionCounts,
  resolveTrustedClipsUrl,
} from "./clips-library";

describe("native Clips library helpers", () => {
  it("normalizes records without trusting malformed values", () => {
    expect(
      normalizeClipSummary({
        id: " rec-1 ",
        title: " ",
        durationMs: -20,
        visibility: "unexpected",
        createdAt: "not-a-date",
      }),
    ).toMatchObject({
      id: "rec-1",
      title: "Untitled clip",
      durationMs: 0,
      visibility: "private",
      createdAt: "1970-01-01T00:00:00.000Z",
    });
    expect(normalizeClipSummary({ title: "Missing id" })).toBeNull();
  });

  it("preserves search jump context while dropping invalid rows", () => {
    expect(
      parseClipsSearchResponse({
        results: [
          {
            id: "rec-1",
            title: "Launch review",
            matchPanel: "transcript",
            matchMs: 4200,
            snippet: "…shipping next week…",
          },
          { title: "Missing id" },
        ],
      }),
    ).toMatchObject([
      {
        id: "rec-1",
        matchPanel: "transcript",
        matchMs: 4200,
        snippet: "…shipping next week…",
      },
    ]);
  });

  it("builds credential-free same-origin share links", () => {
    const url = buildPrivacySafeClipShareUrl("rec/id ?");
    expect(url).toBe("https://clips.agent-native.com/share/rec%2Fid%20%3F");
    expect(url).not.toContain("session");
    expect(
      buildNativeClipSharePayload(
        { id: "rec-1", title: "Private demo" },
        "private",
      ),
    ).toEqual({
      title: "Private demo",
      message:
        "Private demo\nOnly people who already have access can view this clip.",
      url: "https://clips.agent-native.com/share/rec-1",
    });
  });

  it("rejects external media URLs before auth headers can be attached", () => {
    expect(resolveTrustedClipsUrl("/api/video/rec-1")).toBe(
      "https://clips.agent-native.com/api/video/rec-1",
    );
    expect(resolveTrustedClipsUrl("https://example.test/video.mp4")).toBeNull();
  });

  it("formats durations, dates, and comment reaction counts", () => {
    expect(formatClipDuration(65_000)).toBe("1:05");
    expect(formatClipDuration(3_665_000)).toBe("1:01:05");
    expect(
      formatClipDate(
        "2026-07-17T12:00:00.000Z",
        Date.parse("2026-07-18T12:00:00.000Z"),
      ),
    ).toBe("Yesterday");
    expect(
      parseCommentReactionCounts(
        JSON.stringify({
          "🔥": ["a@example.test", "b@example.test"],
          "👍": [],
        }),
      ),
    ).toEqual([{ emoji: "🔥", count: 2 }]);
    expect(parseCommentReactionCounts("broken")).toEqual([]);
  });
});
