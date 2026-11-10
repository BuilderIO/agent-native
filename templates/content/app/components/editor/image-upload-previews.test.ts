// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  commitImageUploadPreview,
  failedImageUploadId,
  failImageUploadPreview,
  hasImageUploadPreview,
  holdImageUploadPreview,
  isFailedImageUploadId,
  noteImageUploadBlockRemoved,
  releaseImageUploadPreview,
  releaseImageUploadPreviewsFor,
  retryImageUpload,
  startImageUploadPreview,
  useImageUploadPreview,
  waitForImageUploadsToSettle,
  wasImageUploadBlockRemoved,
  type ImageUploadPreview,
} from "./image-upload-previews";

const file = new File(["image-bytes"], "diagram.png", { type: "image/png" });
const owner = {};
let nextUrl = 0;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  nextUrl = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:preview-${++nextUrl}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  releaseImageUploadPreviewsFor(owner);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function watchPreview(uploadId: string) {
  const seen: Array<ImageUploadPreview | null> = [];
  function Probe() {
    seen.push(useImageUploadPreview(uploadId));
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(Probe)));
  return {
    latest: () => seen[seen.length - 1] ?? null,
    async unmount() {
      await act(async () => root.unmount());
    },
  };
}

describe("image upload previews", () => {
  it("keeps a block's preview as its upload fails and is retried", async () => {
    holdImageUploadPreview("image-upload-1", file, owner);
    const preview = await watchPreview("image-upload-1");
    const failedPreview = await watchPreview("image-failed-1");
    try {
      expect(preview.latest()).toEqual({
        url: "blob:preview-1",
        failure: null,
      });

      const retry = vi.fn();
      await act(async () =>
        failImageUploadPreview("image-upload-1", "upload", retry),
      );
      expect(failedImageUploadId("image-upload-1")).toBe("image-failed-1");
      expect(isFailedImageUploadId("image-failed-1")).toBe(true);
      expect(failedPreview.latest()).toEqual({
        url: "blob:preview-1",
        failure: "upload",
      });

      retryImageUpload("image-failed-1");
      expect(retry).toHaveBeenCalledTimes(1);

      await act(async () => startImageUploadPreview("image-upload-1"));
      expect(preview.latest()?.failure).toBeNull();
      retryImageUpload("image-upload-1");
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      await preview.unmount();
      await failedPreview.unmount();
    }
  });

  it("revokes the file's URL once the block lets go of it", async () => {
    holdImageUploadPreview("image-upload-1", file, owner);
    const preview = await watchPreview("image-upload-1");
    try {
      await act(async () => releaseImageUploadPreview("image-upload-1"));
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
      expect(preview.latest()).toBeNull();
      expect(hasImageUploadPreview("image-upload-1")).toBe(false);
    } finally {
      await preview.unmount();
    }
  });

  it("lets go of every preview an editor made as it closes", () => {
    const otherEditor = {};
    holdImageUploadPreview("image-upload-1", file, owner);
    holdImageUploadPreview("image-upload-2", file, owner);
    holdImageUploadPreview("image-upload-3", file, otherEditor);

    releaseImageUploadPreviewsFor(owner);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-2");
    expect(hasImageUploadPreview("image-upload-3")).toBe(true);
    releaseImageUploadPreviewsFor(otherEditor);
  });

  it("has no preview URL where the browser can't make one", () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error("Not supported");
    });
    holdImageUploadPreview("image-upload-1", file, owner);
    expect(hasImageUploadPreview("image-upload-1")).toBe(true);
    releaseImageUploadPreview("image-upload-1");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("marks a running or queued upload's deleted block, and drops a failed one's preview", () => {
    holdImageUploadPreview("image-upload-1", file, owner);
    startImageUploadPreview("image-upload-1");
    noteImageUploadBlockRemoved("image-upload-1");
    expect(wasImageUploadBlockRemoved("image-upload-1")).toBe(true);
    expect(hasImageUploadPreview("image-upload-1")).toBe(true);

    holdImageUploadPreview("image-upload-2", file, owner);
    noteImageUploadBlockRemoved("image-upload-2");
    expect(wasImageUploadBlockRemoved("image-upload-2")).toBe(true);
    expect(hasImageUploadPreview("image-upload-2")).toBe(true);

    failImageUploadPreview("image-upload-1", "upload", vi.fn());
    noteImageUploadBlockRemoved("image-failed-1");
    expect(hasImageUploadPreview("image-upload-1")).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });

  it("waits for an editor's waiting and running uploads, not its saved or failed ones", async () => {
    const otherOwner = {};
    holdImageUploadPreview("image-upload-1", file, owner);
    holdImageUploadPreview("image-upload-2", file, owner);
    holdImageUploadPreview("image-upload-3", file, otherOwner);
    startImageUploadPreview("image-upload-1");
    let settled = false;
    const wait = waitForImageUploadsToSettle(owner).then(() => {
      settled = true;
    });

    commitImageUploadPreview("image-upload-1");
    await Promise.resolve();
    expect(settled).toBe(false);

    startImageUploadPreview("image-upload-2");
    failImageUploadPreview("image-upload-2", "upload", vi.fn());
    await wait;
    expect(settled).toBe(true);
    releaseImageUploadPreviewsFor(otherOwner);
  });

  it("ignores ids that aren't image uploads", () => {
    holdImageUploadPreview("image-picker-1", file, owner);
    holdImageUploadPreview("video-upload-1", file, owner);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(hasImageUploadPreview("image-picker-1")).toBe(false);
  });
});
