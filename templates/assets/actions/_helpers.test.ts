import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assetUrls } from "./_helpers.js";

const ORIGINAL_ENV = {
  APP_BASE_PATH: process.env.APP_BASE_PATH,
  VITE_APP_BASE_PATH: process.env.VITE_APP_BASE_PATH,
  APP_URL: process.env.APP_URL,
  URL: process.env.URL,
  DEPLOY_URL: process.env.DEPLOY_URL,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("assetUrls", () => {
  beforeEach(() => {
    restoreEnv();
    process.env.APP_BASE_PATH = "/assets";
    delete process.env.APP_URL;
    delete process.env.URL;
    delete process.env.DEPLOY_URL;
    delete process.env.BETTER_AUTH_URL;
  });

  afterEach(() => {
    restoreEnv();
  });

  it("uses mounted preset paths directly for previews", () => {
    const urls = assetUrls({
      id: "asset-1",
      objectKey: "/library-presets/soft-travel-3d/travel-clay.webp",
      thumbnailObjectKey: "/library-presets/soft-travel-3d/travel-clay.webp",
    });

    expect(urls.previewUrl).toBe(
      "/assets/library-presets/soft-travel-3d/travel-clay.webp",
    );
    expect(urls.thumbnailUrl).toBe(
      "/assets/library-presets/soft-travel-3d/travel-clay.webp",
    );
  });

  it("uses provider URLs directly for previews", () => {
    const urls = assetUrls({
      id: "asset-1",
      objectKey: "https://cdn.example.com/original.png",
      thumbnailObjectKey: "https://cdn.example.com/thumb.webp",
    });

    expect(urls.previewUrl).toBe("https://cdn.example.com/original.png");
    expect(urls.thumbnailUrl).toBe("https://cdn.example.com/thumb.webp");
  });

  it("falls back to the authenticated content route for local storage handles", () => {
    const urls = assetUrls({
      id: "asset-1",
      objectKey: "local:libraries/lib/assets/asset-1/original.png",
      thumbnailObjectKey: "local:libraries/lib/assets/asset-1/thumb.webp",
    });

    expect(urls.previewUrl).toBe("/assets/api/assets/asset-1/content");
    expect(urls.thumbnailUrl).toBe(
      "/assets/api/assets/asset-1/content?variant=thumb",
    );
  });
});
