// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEmbedAuthToken: () => "embed-token-fixture",
}));

import { assetContentUrl } from "@/lib/asset-urls";

import { assetPayload } from "./library";

function embedInFrame() {
  Object.defineProperty(window, "top", {
    value: {},
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "top");
  vi.restoreAllMocks();
});

describe("assetPayload", () => {
  const asset = {
    id: "asset-1",
    libraryId: "library-1",
    mediaType: "image",
    mimeType: "image/png",
    title: "Hero",
    previewUrl: "https://assets.example.test/api/assets/asset-1/content",
  };

  it("hands the host a content URL without the embed session token", () => {
    embedInFrame();
    const payload = assetPayload(asset, "image");
    expect(payload.url).toContain("/api/assets/asset-1/content");
    expect(payload.previewUrl).toContain("/api/assets/asset-1/content");
    expect(JSON.stringify(payload)).not.toContain("__an_embed_token");
    expect(JSON.stringify(payload)).not.toContain("embed-token-fixture");
  });

  it("keeps the token on the picker's own preview requests", () => {
    embedInFrame();
    expect(assetContentUrl("asset-1")).toContain(
      "__an_embed_token=embed-token-fixture",
    );
  });
});
