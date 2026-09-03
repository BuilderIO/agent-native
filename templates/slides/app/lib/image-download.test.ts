// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadImage, imageDownloadFilename } from "./image-download";

describe("downloadImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads fetched image bytes with a filename from the source URL", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await downloadImage("https://example.com/assets/hero-image.png?sig=123");

    expect(
      imageDownloadFilename("https://example.com/assets/hero-image.png"),
    ).toBe("hero-image.png");
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/assets/hero-image.png?sig=123",
      { credentials: "include" },
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("uses the Slides image proxy before opening a blocked source", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("CORS blocked"))
      .mockRejectedValueOnce(new TypeError("proxy unavailable"));
    vi.stubGlobal("fetch", fetch);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await downloadImage("https://cdn.example.com/hero.png");

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhero.png",
      { credentials: "include" },
    );
    expect(click).toHaveBeenCalledTimes(1);
  });
});
