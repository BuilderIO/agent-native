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

  it("uses the animated proxy route when requested", () => {
    expect(
      resolvePlayerThumbnailUrl(
        {
          id: "rec-1",
          thumbnailUrl: "https://cdn.example.com/thumb.jpg",
          animatedThumbnailUrl: "https://cdn.example.com/preview.gif",
        },
        { animated: true },
      ),
    ).toBe("/api/thumbnail/rec-1?animated=1");
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

describe("resolvePlayerThumbnailUrl versioning", () => {
  it("changes the URL when the stored image changes, so a card refetches it", () => {
    const before = resolvePlayerThumbnailUrl({
      id: "rec1",
      thumbnailUrl: "https://storage/a.png",
      mediaUpdatedAt: "2026-09-23T10:00:00.000Z",
    });
    const after = resolvePlayerThumbnailUrl({
      id: "rec1",
      thumbnailUrl: "https://storage/a.png",
      mediaUpdatedAt: "2026-09-23T10:05:00.000Z",
    });
    expect(before).toContain("media=");
    expect(after).not.toBe(before);
  });

  it("leaves a never-edited image's URL as it was", () => {
    expect(
      resolvePlayerThumbnailUrl({ id: "rec1", thumbnailUrl: "https://storage/a.png" }),
    ).toBe("/api/thumbnail/rec1");
  });
});
