import { describe, expect, it } from "vitest";

import { isGoogleProfileImageUrl } from "./google-profile-image.js";

describe("isGoogleProfileImageUrl", () => {
  it("accepts Google profile image CDN URLs", () => {
    expect(
      isGoogleProfileImageUrl("https://lh3.googleusercontent.com/a/photo"),
    ).toBe(true);
    expect(isGoogleProfileImageUrl("https://googleusercontent.com/photo")).toBe(
      true,
    );
  });

  it.each([
    "http://lh3.googleusercontent.com/photo",
    "https://googleusercontent.com.evil.example/photo",
    "https://user:pass@lh3.googleusercontent.com/photo",
    "https://lh3.googleusercontent.com:8443/photo",
    "data:image/png;base64,abc",
    "not-a-url",
    "",
  ])("rejects unsafe profile image URL %s", (value) => {
    expect(isGoogleProfileImageUrl(value)).toBe(false);
  });
});
