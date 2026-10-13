import { describe, expect, it } from "vitest";

import { setUrlSearchParam, withMediaVersion } from "./media-url";

describe("versioning a media URL", () => {
  it("adds the version to an absolute URL", () => {
    expect(
      withMediaVersion("https://cdn.example.com/a.mp4", "2026-09-21T10:00:00Z"),
    ).toBe("https://cdn.example.com/a.mp4?media=2026-09-21T10%3A00%3A00Z");
  });

  it("keeps an app-relative URL relative", () => {
    expect(withMediaVersion("/api/video/rec_1", 42)).toBe(
      "/api/video/rec_1?media=42",
    );
  });

  it("replaces a stale version rather than stacking one", () => {
    const once = withMediaVersion("/api/video/rec_1", 1);
    expect(withMediaVersion(once, 2)).toBe("/api/video/rec_1?media=2");
  });

  it("leaves the URL alone when there is no version to add", () => {
    expect(withMediaVersion("/api/video/rec_1", null)).toBe("/api/video/rec_1");
    expect(withMediaVersion("/api/video/rec_1", "")).toBe("/api/video/rec_1");
  });

  it("keeps an existing query string", () => {
    expect(withMediaVersion("/api/video/rec_1?t=abc", 7)).toBe(
      "/api/video/rec_1?t=abc&media=7",
    );
  });

  it("never throws on something that is not really a URL", () => {
    expect(() =>
      setUrlSearchParam("::not a url::", "media", "1"),
    ).not.toThrow();
    expect(withMediaVersion("", 1)).toBe("");
  });
});
