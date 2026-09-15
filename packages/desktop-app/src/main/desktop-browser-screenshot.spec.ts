import { describe, expect, it, vi } from "vitest";

import { captureDesktopBrowserScreenshot } from "./desktop-browser-screenshot";

function fakeImage(size: { width: number; height: number }) {
  const image = {
    getSize: () => size,
    resize: vi.fn((nextSize: { width: number; height: number }) =>
      fakeImage(nextSize),
    ),
    toJPEG: vi.fn(() => Buffer.from("jpeg")),
  };
  return image;
}

describe("captureDesktopBrowserScreenshot", () => {
  it("downscales high-density browser pixels before returning them", async () => {
    const image = fakeImage({ width: 3_200, height: 1_800 });
    const contents = {
      capturePage: vi.fn(async () => image),
    };

    await expect(captureDesktopBrowserScreenshot(contents)).resolves.toEqual({
      data: Buffer.from("jpeg").toString("base64"),
      mediaType: "image/jpeg",
      width: 1_600,
      height: 900,
    });
    expect(image.resize).toHaveBeenCalledWith({ width: 1_600, height: 900 });
  });

  it("rejects pixels when the active browser changes during capture", async () => {
    const image = fakeImage({ width: 1_600, height: 900 });
    let isActive = true;
    const contents = {
      capturePage: vi.fn(async () => {
        isActive = false;
        return image;
      }),
    };

    await expect(
      captureDesktopBrowserScreenshot(contents, () => isActive),
    ).rejects.toThrow("changed while the screenshot was being captured");
  });
});
