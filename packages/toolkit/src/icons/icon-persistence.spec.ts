import { describe, expect, it } from "vitest";

import { persistedIconValue } from "./ResourceIconPicker.js";
import type { ResourceIconImage } from "./types.js";

describe("persistedIconValue", () => {
  it("removes preview-only metadata before saving an uploaded image", () => {
    const uploaded: ResourceIconImage = {
      version: 1,
      kind: "image",
      authority: "url",
      assetId: "https://cdn.example.com/logo.png",
      alt: "Team logo",
      previewUrl: "blob:temporary-preview",
    };

    expect(persistedIconValue(uploaded)).toEqual({
      version: 1,
      kind: "image",
      authority: "url",
      assetId: "https://cdn.example.com/logo.png",
      alt: "Team logo",
    });
    expect(uploaded.previewUrl).toBe("blob:temporary-preview");
  });

  it("repairs image recents saved by the previous picker", () => {
    const recent = JSON.parse(
      JSON.stringify({
        version: 1,
        kind: "image",
        authority: "url",
        assetId: "https://cdn.example.com/logo.png",
        previewUrl: "https://cdn.example.com/logo.png",
      }),
    );

    expect(Object.keys(persistedIconValue(recent)).sort()).toEqual([
      "assetId",
      "authority",
      "kind",
      "version",
    ]);
  });
});
