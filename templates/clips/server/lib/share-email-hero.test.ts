import { afterEach, describe, expect, it, vi } from "vitest";

import { recordingShareHeroHtml } from "./share-email-hero";

const CTX = { href: "https://clips.example.com/r/rec-1" };

describe("recordingShareHeroHtml", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the animated thumbnail for GIF-only recordings", () => {
    vi.stubEnv("APP_URL", "https://clips.example.com");

    const html = recordingShareHeroHtml(
      { thumbnailUrl: null, animatedThumbnailUrl: "/api/media/preview.gif" },
      CTX,
    );

    expect(html).toContain("https://clips.example.com/api/media/preview.gif");
  });

  it("prefers the still thumbnail when both are present", () => {
    vi.stubEnv("APP_URL", "https://clips.example.com");

    const html = recordingShareHeroHtml(
      {
        thumbnailUrl: "/api/media/still.jpg",
        animatedThumbnailUrl: "/api/media/preview.gif",
      },
      CTX,
    );

    expect(html).toContain("https://clips.example.com/api/media/still.jpg");
    expect(html).not.toContain("preview.gif");
  });

  it("includes the configured base path in thumbnail and badge URLs", () => {
    vi.stubEnv("APP_URL", "https://gateway.example.com");
    vi.stubEnv("APP_BASE_PATH", "/clips");

    const html = recordingShareHeroHtml(
      { thumbnailUrl: "/api/media/still.jpg" },
      CTX,
    );

    expect(html).toContain(
      "https://gateway.example.com/clips/api/media/still.jpg",
    );
    expect(html).toContain("https://gateway.example.com/clips/play-badge.png");
  });

  it("returns nothing when the recording has no thumbnail", () => {
    vi.stubEnv("APP_URL", "https://clips.example.com");

    expect(
      recordingShareHeroHtml(
        { thumbnailUrl: null, animatedThumbnailUrl: null },
        CTX,
      ),
    ).toBeUndefined();
  });
});
