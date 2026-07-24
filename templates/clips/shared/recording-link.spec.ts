/**
 * Regression guard: every surface that auto-copies a clip link must hand the
 * user the PUBLIC `/share/<id>` viewer page. Clips previously shipped `/r/<id>`
 * — the client-rendered owner dashboard — which works for the author and shows
 * a sign-in prompt to everyone they paste it to.
 */
import { describe, expect, it } from "vitest";

import { buildRecordingShareUrl, recordingSharePath } from "./recording-link";

describe("recordingSharePath", () => {
  it("builds the public /share/:id path", () => {
    expect(recordingSharePath("abc123")).toBe("/share/abc123");
  });

  it("URL-encodes ids with special characters", () => {
    expect(recordingSharePath("a b/c?d#e")).toBe("/share/a%20b%2Fc%3Fd%23e");
    expect(recordingSharePath("clip+1&2")).toBe("/share/clip%2B1%262");
  });
});

describe("buildRecordingShareUrl", () => {
  it("joins origin and path into an absolute URL", () => {
    expect(
      buildRecordingShareUrl({
        recordingId: "abc123",
        origin: "https://clips.example.com",
      }),
    ).toBe("https://clips.example.com/share/abc123?ref=clip_share");
  });

  it("joins a base path between the origin and the share path", () => {
    expect(
      buildRecordingShareUrl({
        recordingId: "abc123",
        origin: "https://clips.example.com",
        basePath: "/clips",
      }),
    ).toBe("https://clips.example.com/clips/share/abc123?ref=clip_share");
  });

  it("tolerates trailing slashes on the origin and the base path", () => {
    const url = buildRecordingShareUrl({
      recordingId: "abc123",
      origin: "https://clips.example.com///",
      basePath: "/clips//",
    });
    expect(url).toBe(
      "https://clips.example.com/clips/share/abc123?ref=clip_share",
    );
  });

  it("never emits a double slash in the path", () => {
    const cases = [
      { origin: "https://clips.example.com/", basePath: "" },
      { origin: "https://clips.example.com", basePath: "/" },
      { origin: "https://clips.example.com/", basePath: "/clips/" },
      { origin: "  https://clips.example.com/  ", basePath: "  /clips/  " },
    ];
    for (const { origin, basePath } of cases) {
      const url = buildRecordingShareUrl({
        recordingId: "abc123",
        origin,
        basePath,
      });
      expect(new URL(url).pathname).not.toMatch(/\/\//);
      expect(new URL(url).pathname.endsWith("/share/abc123")).toBe(true);
    }
  });

  it("always carries ref=clip_share", () => {
    const url = new URL(
      buildRecordingShareUrl({
        recordingId: "abc123",
        origin: "https://clips.example.com",
      }),
    );
    expect(url.searchParams.get("ref")).toBe("clip_share");
  });

  it("adds via=<ownerId> only when an owner id is supplied", () => {
    const withOwner = new URL(
      buildRecordingShareUrl({
        recordingId: "abc123",
        origin: "https://clips.example.com",
        ownerId: "user_42",
      }),
    );
    expect(withOwner.searchParams.get("via")).toBe("user_42");

    for (const ownerId of [undefined, null, "", "   "]) {
      const url = new URL(
        buildRecordingShareUrl({
          recordingId: "abc123",
          origin: "https://clips.example.com",
          ownerId,
        }),
      );
      expect(url.searchParams.has("via")).toBe(false);
    }
  });

  it("encodes the recording id inside the absolute URL", () => {
    const url = buildRecordingShareUrl({
      recordingId: "a b/c",
      origin: "https://clips.example.com",
    });
    expect(url).toBe(
      "https://clips.example.com/share/a%20b%2Fc?ref=clip_share",
    );
  });

  // The exact bug we shipped before: auto-copy handed out `/r/<id>`, the
  // owner-only dashboard. Recipients saw a sign-in wall and Slack could not
  // unfurl it. Copied links must stay on `/share/`.
  it("points at /share/, never the /r/ owner dashboard", () => {
    const url = buildRecordingShareUrl({
      recordingId: "abc123",
      origin: "https://clips.example.com",
      basePath: "/clips",
      ownerId: "user_42",
    });
    expect(new URL(url).pathname).toBe("/clips/share/abc123");
    expect(url).not.toContain("/r/abc123");
    expect(recordingSharePath("abc123").startsWith("/r/")).toBe(false);
  });
});
