import { describe, expect, it } from "vitest";

import {
  isGoogleDefaultAvatarUrl,
  isGoogleProfileImageUrl,
} from "./google-profile-image.js";

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
    "https://lh3.googleusercontent.com/a/default-user=s96-c",
    "https://lh3.googleusercontent.com/a/default-user",
    "https://lh3.googleusercontent.com/a/default-user/s96-c",
  ])("treats Google's stand-in silhouette %s as no photo", (value) => {
    expect(isGoogleProfileImageUrl(value)).toBe(false);
  });

  it("still accepts a photo whose path only resembles the stand-in", () => {
    expect(
      isGoogleProfileImageUrl(
        "https://lh3.googleusercontent.com/a/default-users-photo=s96-c",
      ),
    ).toBe(true);
  });

  it.each([undefined, null, 42, {}, ["https://lh3.googleusercontent.com/a/x"]])(
    "rejects a non-string value %j",
    (value) => {
      expect(isGoogleProfileImageUrl(value)).toBe(false);
      expect(isGoogleDefaultAvatarUrl(value)).toBe(false);
    },
  );

  it.each(["   ", "\n\t"])("rejects a blank value %j", (value) => {
    expect(isGoogleProfileImageUrl(value)).toBe(false);
    expect(isGoogleDefaultAvatarUrl(value)).toBe(false);
  });

  it("ignores the whitespace around an otherwise good URL", () => {
    expect(
      isGoogleProfileImageUrl("  https://lh3.googleusercontent.com/a/photo \n"),
    ).toBe(true);
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

describe("isGoogleDefaultAvatarUrl", () => {
  it("names Google's stand-in silhouette and nothing else", () => {
    expect(
      isGoogleDefaultAvatarUrl(
        "https://lh3.googleusercontent.com/a/default-user=s96-c",
      ),
    ).toBe(true);
    expect(
      isGoogleDefaultAvatarUrl("https://lh3.googleusercontent.com/a/photo"),
    ).toBe(false);
    // Another host's "default-user" path is not Google's.
    expect(
      isGoogleDefaultAvatarUrl("https://cdn.example.com/a/default-user=s96-c"),
    ).toBe(false);
    expect(isGoogleDefaultAvatarUrl("data:image/jpeg;base64,abc")).toBe(false);
  });
});
