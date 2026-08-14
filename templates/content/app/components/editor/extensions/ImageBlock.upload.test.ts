// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  completeImageFileUpload,
  ImageRenderError,
  waitForRenderedImage,
} from "../image-upload";

describe("image node-view upload completion", () => {
  const file = new File(["image-bytes"], "diagram.png", {
    type: "image/png",
  });

  it("reports success only after the committed image node renders", async () => {
    const events: string[] = [];
    const upload = vi.fn(async () => {
      events.push("uploaded");
      return "https://cdn.example.com/diagram.png";
    });
    const waitForRender = vi.fn(async () => {
      events.push("loaded");
    });
    const stageAttributes = vi.fn(() => {
      events.push("staged");
    });
    const commitAttributes = vi.fn(() => {
      events.push("committed");
    });
    const persistCommittedImage = vi.fn(async () => {
      events.push("persisted");
      return true;
    });

    await expect(
      completeImageFileUpload({
        file,
        upload,
        stageAttributes,
        waitForRender,
        commitAttributes,
        persistCommittedImage,
      }),
    ).resolves.toBe("https://cdn.example.com/diagram.png");

    expect(events).toEqual([
      "uploaded",
      "staged",
      "loaded",
      "committed",
      "persisted",
    ]);
    expect(stageAttributes).toHaveBeenCalledWith(
      "https://cdn.example.com/diagram.png",
    );
    expect(commitAttributes).toHaveBeenCalledWith(
      "https://cdn.example.com/diagram.png",
    );
  });

  it("does not complete when the committed image node cannot render", async () => {
    const stageAttributes = vi.fn();
    const commitAttributes = vi.fn();
    const persistCommittedImage = vi.fn();

    await expect(
      completeImageFileUpload({
        file,
        upload: async () => "https://cdn.example.com/unreachable.png",
        stageAttributes,
        waitForRender: async () => {
          throw new ImageRenderError();
        },
        commitAttributes,
        persistCommittedImage,
      }),
    ).rejects.toThrow("Image could not be loaded.");

    expect(stageAttributes).toHaveBeenCalledOnce();
    expect(commitAttributes).not.toHaveBeenCalled();
    expect(persistCommittedImage).not.toHaveBeenCalled();
  });

  it("does not complete when the rendered image cannot be persisted", async () => {
    const commitAttributes = vi.fn();

    await expect(
      completeImageFileUpload({
        file,
        upload: async () => "https://cdn.example.com/diagram.svg",
        stageAttributes: vi.fn(),
        waitForRender: async () => {},
        commitAttributes,
        persistCommittedImage: async () => false,
      }),
    ).rejects.toThrow("Image could not be saved.");

    expect(commitAttributes).toHaveBeenCalledOnce();
  });

  it("waits for the image element committed into the editor", async () => {
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", { value: false });
    let committed = false;
    const completion = waitForRenderedImage(() => (committed ? image : null));

    committed = true;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    image.dispatchEvent(new Event("load"));

    await expect(completion).resolves.toBeUndefined();
  });

  it("rejects when the committed editor image errors", async () => {
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", { value: false });
    const completion = waitForRenderedImage(() => image);

    image.dispatchEvent(new Event("error"));

    await expect(completion).rejects.toBeInstanceOf(ImageRenderError);
  });
});
