// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PngCaptureError } from "@/pages/design-editor/png-export-render";

import { waitForScreenImages } from "./download-all-screens-pdf";

beforeEach(() => {
  Object.defineProperty(document, "images", {
    configurable: true,
    get: () => document.querySelectorAll("img"),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "images");
});

function createImage({
  complete,
  naturalWidth,
}: {
  complete: boolean;
  naturalWidth: number;
}) {
  const image = document.createElement("img");
  image.setAttribute("src", "/screen-image.png");
  let currentComplete = complete;
  let currentNaturalWidth = naturalWidth;
  Object.defineProperties(image, {
    complete: {
      configurable: true,
      get: () => currentComplete,
    },
    naturalWidth: {
      configurable: true,
      get: () => currentNaturalWidth,
    },
    decode: {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    },
  });
  document.body.append(image);
  return {
    image,
    load: (width = 80) => {
      currentComplete = true;
      currentNaturalWidth = width;
      image.dispatchEvent(new Event("load"));
    },
    fail: () => {
      currentComplete = true;
      currentNaturalWidth = 0;
      image.dispatchEvent(new Event("error"));
    },
  };
}

it("waits for load and decode before allowing PDF capture", async () => {
  const target = createImage({ complete: false, naturalWidth: 0 });
  const wait = waitForScreenImages(document);
  target.load();

  await expect(wait).resolves.toBeUndefined();
  expect(target.image.decode).toHaveBeenCalledOnce();
});

it("fails for a broken image and removes all pending listeners", async () => {
  const failed = createImage({ complete: false, naturalWidth: 0 });
  const pending = createImage({ complete: false, naturalWidth: 0 });
  const failedRemove = vi.spyOn(failed.image, "removeEventListener");
  const pendingRemove = vi.spyOn(pending.image, "removeEventListener");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const wait = expect(waitForScreenImages(document)).rejects.toMatchObject({
    name: PngCaptureError.name,
    code: "blob-failed",
  });

  failed.fail();
  await wait;

  for (const remove of [failedRemove, pendingRemove]) {
    expect(remove).toHaveBeenCalledWith("load", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("error", expect.any(Function));
  }
  expect(pending.image.decode).not.toHaveBeenCalled();
});

it("fails when an image is already complete but has no decoded pixels", async () => {
  createImage({ complete: true, naturalWidth: 0 });

  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(waitForScreenImages(document)).rejects.toMatchObject({
    name: PngCaptureError.name,
    code: "blob-failed",
  });
});

it("fails when the browser cannot decode an otherwise loaded image", async () => {
  const target = createImage({ complete: true, naturalWidth: 80 });
  vi.mocked(target.image.decode).mockRejectedValue(new Error("decode failed"));
  vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(waitForScreenImages(document)).rejects.toMatchObject({
    name: PngCaptureError.name,
    code: "blob-failed",
  });
});

it("removes pending listeners when image loading times out", async () => {
  vi.useFakeTimers();
  const target = createImage({ complete: false, naturalWidth: 0 });
  const remove = vi.spyOn(target.image, "removeEventListener");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const wait = expect(waitForScreenImages(document)).rejects.toMatchObject({
    name: PngCaptureError.name,
    code: "blob-failed",
  });

  await vi.advanceTimersByTimeAsync(10_000);
  await wait;

  expect(remove).toHaveBeenCalledWith("load", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("error", expect.any(Function));
});
