import { describe, expect, it } from "vitest";

import { buildClipsExtensionBaseUrl } from "./extension-auth";

describe("buildClipsExtensionBaseUrl", () => {
  it("keeps a root-mounted app at its origin", () => {
    expect(buildClipsExtensionBaseUrl("https://clips.example.com", "/")).toBe(
      "https://clips.example.com",
    );
  });

  it("keeps the configured mount path for self-hosted apps", () => {
    expect(
      buildClipsExtensionBaseUrl("https://clips.example.com", "/clips/"),
    ).toBe("https://clips.example.com/clips");
  });

  it("does not carry query or hash state into the extension setting", () => {
    expect(
      buildClipsExtensionBaseUrl(
        "https://clips.example.com",
        "/clips/?clipsExtensionAuth=1#signed-in",
      ),
    ).toBe("https://clips.example.com/clips");
  });
});
