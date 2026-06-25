import { describe, expect, it } from "vitest";

import {
  buildClipsShareMeta,
  clipsShareDescription,
  clipsSharePageTitle,
  displayRecordingTitle,
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
});
