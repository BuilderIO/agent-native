import { describe, expect, it } from "vitest";

import {
  buildClipsShareMeta,
  clipsShareDescription,
  clipsSharePageTitle,
  displayRecordingTitle,
  preferredThumbnailVariant,
  resolveClipsSocialImageUrl,
} from "./share-meta";

describe("Clips share metadata", () => {
  it("uses generated titles in page and Slack/Open Graph descriptions", () => {
    expect(clipsSharePageTitle("Demo walkthrough")).toBe(
      "Demo walkthrough · Clips",
    );
    expect(displayRecordingTitle("Demo walkthrough")).toBe("Demo walkthrough");
    expect(
      clipsShareDescription({
        title: "Demo walkthrough",
        description: "",
      }),
    ).toBe('Watch "Demo walkthrough" on Clips.');
  });

  it("keeps untitled recordings generic", () => {
    expect(clipsSharePageTitle("Untitled recording")).toBe(
      "Clip recording · Clips",
    );
    expect(displayRecordingTitle("Untitled recording")).toBe("Untitled Clip");
  });

  it("does not expose serialized payloads as recording titles", () => {
    const serializedTitle = '[{"id":"recording-1","status":"ready"}]';

    expect(clipsSharePageTitle(serializedTitle)).toBe("Clip recording · Clips");
    expect(displayRecordingTitle(serializedTitle)).toBe("Untitled Clip");
  });

  it("builds absolute image metadata for crawler previews", () => {
    const meta = buildClipsShareMeta({
      origin: "https://clips.example.com",
      shareUrl: "https://clips.example.com/share/rec-1",
      recording: {
        title: "Launch notes",
        description: "A short recording",
        thumbnailUrl: "/api/media/thumb-1",
        animatedThumbnailUrl: null,
      },
    });

    expect(meta).toContainEqual({
      property: "og:url",
      content: "https://clips.example.com/share/rec-1",
    });
    expect(meta).toContainEqual({
      property: "og:image",
      content: "https://clips.example.com/api/media/thumb-1",
    });
    expect(meta).toContainEqual({
      name: "twitter:image",
      content: "https://clips.example.com/api/media/thumb-1",
    });
    expect(meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });

  it("uses a video frame in crawler metadata when no thumbnail is stored", () => {
    const meta = buildClipsShareMeta({
      origin: "https://clips.example.com",
      basePath: "/clips",
      shareUrl: "https://clips.example.com/clips/share/rec-1",
      recording: {
        id: "rec-1",
        title: "Launch notes",
        description: "A short recording",
        thumbnailUrl: null,
        animatedThumbnailUrl: null,
        visibility: "public",
        status: "ready",
      },
    });

    expect(meta).toContainEqual({
      property: "og:image",
      content:
        "https://clips.example.com/clips/api/agent-frame.jpg?id=rec-1&atMs=350",
    });
    expect(meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });

  it("prefers the stable still thumbnail over an animated preview", () => {
    expect(
      preferredThumbnailVariant({
        thumbnailUrl: "/api/thumbnail/rec-1",
        animatedThumbnailUrl: "https://cdn.example.com/preview.gif",
      }),
    ).toBe("still");

    const meta = buildClipsShareMeta({
      origin: "https://clips.example.com",
      recording: {
        title: "Launch notes",
        thumbnailUrl: "/api/thumbnail/rec-1",
        animatedThumbnailUrl: "https://cdn.example.com/preview.gif",
      },
    });

    expect(meta).toContainEqual({
      property: "og:image",
      content: "https://clips.example.com/api/thumbnail/rec-1",
    });
  });

  it("falls back to an animated thumbnail only when no still exists", () => {
    expect(
      preferredThumbnailVariant({
        thumbnailUrl: null,
        animatedThumbnailUrl: "https://cdn.example.com/preview.gif",
      }),
    ).toBe("animated");
  });

  it("uses a public video frame when a recording has no stored thumbnail", () => {
    const imageUrl = resolveClipsSocialImageUrl({
      recording: {
        id: "rec-1",
        title: "Launch notes",
        visibility: "public",
        status: "ready",
        thumbnailUrl: null,
        animatedThumbnailUrl: null,
      },
      origin: "https://clips.example.com",
    });

    expect(imageUrl).toBe(
      "https://clips.example.com/api/agent-frame.jpg?id=rec-1&atMs=350",
    );
  });

  it("proxies public stored thumbnails through the same-origin image route", () => {
    expect(
      resolveClipsSocialImageUrl({
        recording: {
          id: "rec-1",
          title: "Launch notes",
          visibility: "public",
          status: "ready",
          thumbnailUrl: "https://cdn.example.com/preview.jpg",
        },
        origin: "https://clips.example.com",
      }),
    ).toBe("https://clips.example.com/api/thumbnail/rec-1");
  });

  it("does not expose generated frames for non-public recordings", () => {
    expect(
      resolveClipsSocialImageUrl({
        recording: {
          id: "rec-1",
          visibility: "private",
          status: "ready",
          thumbnailUrl: null,
          animatedThumbnailUrl: null,
        },
        origin: "https://clips.example.com",
      }),
    ).toBeUndefined();
  });

  it("does not expose social images for password-protected recordings", () => {
    expect(
      resolveClipsSocialImageUrl({
        recording: {
          id: "rec-1",
          visibility: "public",
          status: "ready",
          hasPassword: true,
          thumbnailUrl: null,
          animatedThumbnailUrl: null,
        },
        origin: "https://clips.example.com",
      }),
    ).toBeUndefined();
  });
});
