import { describe, expect, it } from "vitest";

import { buildSocialShareUrl } from "../../lib/social-share";

describe("recording share popover", () => {
  it("keeps social destinations as distinct share jobs", () => {
    const clipUrl = "https://clips.example/share/abc?via=owner";
    const title = "Quarterly demo & notes";

    expect(buildSocialShareUrl("linkedin", clipUrl, title)).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(clipUrl)}`,
    );
    expect(buildSocialShareUrl("x", clipUrl, title)).toBe(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(clipUrl)}&text=${encodeURIComponent(title)}`,
    );
    expect(buildSocialShareUrl("facebook", clipUrl, title)).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(clipUrl)}`,
    );
    expect(buildSocialShareUrl("email", clipUrl, title)).toContain(
      `subject=${encodeURIComponent(title)}`,
    );
  });
});
