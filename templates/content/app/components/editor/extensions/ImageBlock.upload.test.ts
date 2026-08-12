// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  completeImageFileUpload,
  ImageRenderError,
  waitForImageLoad,
} from "../image-upload";

describe("image node-view upload completion", () => {
  const file = new File(["image-bytes"], "diagram.png", {
    type: "image/png",
  });

  it("updates the image node only after the uploaded URL renders", async () => {
    const events: string[] = [];
    const upload = vi.fn(async () => {
      events.push("uploaded");
      return "https://cdn.example.com/diagram.png";
    });
    const load = vi.fn(async () => {
      events.push("loaded");
    });
    const updateAttributes = vi.fn(() => {
      events.push("updated");
    });

    await expect(
      completeImageFileUpload({ file, upload, load, updateAttributes }),
    ).resolves.toBe("https://cdn.example.com/diagram.png");

    expect(events).toEqual(["uploaded", "loaded", "updated"]);
    expect(updateAttributes).toHaveBeenCalledWith({
      src: "https://cdn.example.com/diagram.png",
      uploadId: null,
    });
  });

  it("keeps the placeholder unchanged when the uploaded URL cannot render", async () => {
    const updateAttributes = vi.fn();

    await expect(
      completeImageFileUpload({
        file,
        upload: async () => "https://cdn.example.com/unreachable.png",
        load: async () => {
          throw new ImageRenderError();
        },
        updateAttributes,
      }),
    ).rejects.toThrow("Image could not be loaded.");

    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("resolves and cleans up when the browser loads the image", async () => {
    const image = new Image();
    const completion = waitForImageLoad(
      "https://cdn.example.com/diagram.png",
      () => image,
    );

    image.onload?.(new Event("load"));

    await expect(completion).resolves.toBeUndefined();
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
  });

  it("rejects and cleans up when the browser rejects the image", async () => {
    const image = new Image();
    const completion = waitForImageLoad(
      "https://cdn.example.com/unreachable.png",
      () => image,
    );

    image.onerror?.(new Event("error"));

    await expect(completion).rejects.toBeInstanceOf(ImageRenderError);
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
  });
});
