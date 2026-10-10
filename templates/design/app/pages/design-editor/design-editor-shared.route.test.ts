import { describe, expect, it } from "vitest";

import { previewUrlAtLiveRoute } from "./design-editor-shared";

describe("previewUrlAtLiveRoute", () => {
  it("preserves a same-origin double-slash pathname", () => {
    expect(
      previewUrlAtLiveRoute(
        "https://preview.example/account",
        "//same-origin/path?tab=details#section",
      ),
    ).toBe("https://preview.example//same-origin/path?tab=details#section");
  });

  it.each(["/\\external.example/path", "/\t/external.example/path"])(
    "keeps the preview URL when the route is unsafe: %s",
    (routePath) => {
      const previewUrl = "https://preview.example/account";
      expect(previewUrlAtLiveRoute(previewUrl, routePath)).toBe(previewUrl);
    },
  );
});
