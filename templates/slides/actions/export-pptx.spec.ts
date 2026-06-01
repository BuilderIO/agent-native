import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "local@example.com"),
}));

vi.mock("../server/db/index.js", () => ({}));

import { fetchImageAsBase64 } from "./export-pptx";

describe("fetchImageAsBase64", () => {
  beforeEach(() => {
    mocks.ssrfSafeFetch.mockReset();
  });

  it("downloads images through the SSRF-safe fetch helper", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      fetchImageAsBase64("https://cdn.example/logo.png"),
    ).resolves.toBe("data:image/png;base64,AQID");
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      "https://cdn.example/logo.png",
      { signal: expect.any(AbortSignal) },
      { maxRedirects: 3 },
    );
  });

  it("rejects non-image responses", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(fetchImageAsBase64("https://cdn.example/page")).resolves.toBe(
      null,
    );
  });

  it("returns null when SSRF-safe fetch blocks a URL", async () => {
    mocks.ssrfSafeFetch.mockRejectedValue(
      new Error("SSRF blocked: refusing to fetch private/internal address"),
    );

    await expect(
      fetchImageAsBase64("http://127.0.0.1/image.png"),
    ).resolves.toBe(null);
  });
});
