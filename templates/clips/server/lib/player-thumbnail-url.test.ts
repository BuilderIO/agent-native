import { describe, expect, it } from "vitest";

import {
  localRecordingThumbnailRoute,
  resolvePlayerThumbnailUrl,
} from "./player-thumbnail-url";

describe("player thumbnail URLs", () => {
  it("uses a same-origin route for static thumbnails", () => {
    expect(
      resolvePlayerThumbnailUrl({
        id: "rec/1",
        thumbnailUrl: "https://cdn.example.com/thumb.jpg",
      }),
    ).toBe("/api/thumbnail/rec%2F1");
  });

  it("falls back to animated thumbnails and preserves access tokens", () => {
    expect(
      resolvePlayerThumbnailUrl(
        { id: "rec-1", thumbnailUrl: null, animatedThumbnailUrl: "gif" },
        {
          accessToken: "media-token",
          appPath: (path) => `/clips${path}`,
        },
      ),
    ).toBe("/clips/api/thumbnail/rec-1?t=media-token");
  });

  it("returns null when no thumbnail exists", () => {
    expect(resolvePlayerThumbnailUrl({ id: "rec-1" })).toBeNull();
  });

  it("encodes ids in the route", () => {
    expect(localRecordingThumbnailRoute("rec/1")).toBe(
      "/api/thumbnail/rec%2F1",
    );
  });
});
