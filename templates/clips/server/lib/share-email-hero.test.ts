import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recordingShareEmailContent,
  recordingShareHeroHtml,
} from "./share-email-hero";

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

describe("recordingShareEmailContent", () => {
  it("matches the Clips share layout without an AI button", () => {
    const content = recordingShareEmailContent(
      { title: "Recording start countdown sequence" },
      { sender: { name: "Milos" }, href: CTX.href },
    );

    expect(content.heading).toBe(
      'Milos shared "Recording start countdown sequence" with you',
    );
    expect(content.ctaLabel).toBe("Open Recording");
    expect(content.afterCtaHtml).not.toContain("Copy and paste this link");
    expect(content.afterCtaHtml).not.toContain(CTX.href);
    expect(content.afterCtaHtml).not.toContain("Summarize with AI");
  });

  it("escapes sender names in trusted email markup", () => {
    const content = recordingShareEmailContent(
      { title: "A clip" },
      {
        sender: { name: '<img src=x onerror="alert(1)">' },
        href: CTX.href,
      },
    );

    expect(content.afterCtaHtml).not.toContain("<img");
    expect(content.afterCtaHtml).toContain("&lt;img");
  });
});
