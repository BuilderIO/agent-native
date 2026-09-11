import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "/assets",
  appPath: (path: string) => `/assets${path}`,
}));

vi.mock("@agent-native/core/client/host", () => ({
  getEmbedAuthToken: () => null,
}));

import { assetContentUrl } from "./asset-urls";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assetContentUrl", () => {
  it("mounts content paths under the app base path", () => {
    expect(assetContentUrl("asset id", { variant: "thumb" })).toBe(
      "/assets/api/assets/asset%20id/content?variant=thumb",
    );
  });

  it("uses the external embed token before the URL token", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?__an_embed_token=url-token",
      },
      __AGENT_NATIVE_EXTERNAL_EMBED: { token: "injected-token" },
    });

    expect(assetContentUrl("asset-id")).toBe(
      "/assets/api/assets/asset-id/content?__an_embed_token=injected-token",
    );
  });

  it("uses the URL embed token when no injected token exists", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?__an_embed_token=url-token",
      },
    });

    expect(assetContentUrl("asset-id")).toBe(
      "/assets/api/assets/asset-id/content?__an_embed_token=url-token",
    );
  });
});
