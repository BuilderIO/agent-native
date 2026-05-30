import { describe, expect, it } from "vitest";

import action from "./get-asset.js";

describe("get-asset", () => {
  it("returns starter preset assets without querying persisted assets", async () => {
    const asset = await action.run({
      id: "starter-soft-travel-3d-location-clay",
    });

    expect(asset).toMatchObject({
      id: "starter-soft-travel-3d-location-clay",
      libraryId: "starter:soft-travel-3d",
      mediaType: "image",
      role: "reference",
      status: "ready",
      title: "Soft clay location marker",
      mimeType: "image/webp",
      metadata: {
        isStarterAsset: true,
        presetId: "soft-travel-3d",
      },
    });
    expect(asset.previewUrl).toContain(
      "/library-presets/soft-travel-3d/location-clay.webp",
    );
    expect(asset.downloadUrl).toContain(
      "Special:Redirect/file/Location-dynamic-clay.png",
    );
    expect(asset.urlPath).toBe("/asset/starter-soft-travel-3d-location-clay");
  });
});
