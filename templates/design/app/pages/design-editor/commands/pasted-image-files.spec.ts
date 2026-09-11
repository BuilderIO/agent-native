// @vitest-environment happy-dom

import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesignFile } from "../types";
import {
  replacePastedImageSource,
  runPastedImageFiles,
  type PastedImageFilesArgs,
} from "./pasted-image-files";

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

function args(
  applyLocalContentUpdate: PastedImageFilesArgs["applyLocalContentUpdate"],
  replacePreviewContent: PastedImageFilesArgs["replacePreviewContent"],
  uploadImageFileForHtml: PastedImageFilesArgs["uploadImageFileForHtml"],
  getFreshActiveContent: () => string = () => "<main></main>",
  getFreshActivePreviewContent: PastedImageFilesArgs["getFreshActivePreviewContent"] = () =>
    null,
): PastedImageFilesArgs {
  return {
    activeFile: { id: "screen-1" } as DesignFile,
    applyFileContentUpdate: vi.fn(),
    applyLocalContentUpdate,
    boardFileId: undefined,
    canEditDesign: true,
    canvasContainerRef: ref(null),
    canvasFrameGeometryById: {},
    getFreshActiveContent,
    getFreshActivePreviewContent,
    getScreenContent: () => "<main></main>",
    overviewScreens: [],
    overviewSelectedScreenIds: [],
    pasteCascadeRef: ref(0),
    replacePreviewContent,
    selectInsertedLayers: vi.fn(),
    t: (key) => key,
    uploadImageFileForHtml,
    viewModeRef: ref("single"),
    zoom: 100,
  };
}

const file = new File(["image"], "photo.png", { type: "image/png" });

describe("runPastedImageFiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a local preview before replacing it with the uploaded URL", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:preview");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    let resolveUpload!: (url: string) => void;
    const upload = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const updates: Array<{ content: string; persist?: boolean }> = [];
    const previews: string[] = [];
    let currentContent = "<main></main>";
    const replacePreviewContent = vi.fn((content: string) => {
      previews.push(content);
      currentContent = content;
    });
    const applyLocalContentUpdate = vi.fn((content, options) => {
      updates.push({ content, persist: options?.persist });
    });

    expect(
      runPastedImageFiles(
        args(
          applyLocalContentUpdate,
          replacePreviewContent,
          upload,
          () => currentContent,
        ),
        [file],
        { fileId: "screen-1", point: { x: 40, y: 60 } },
      ),
    ).toBe(true);
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(updates).toHaveLength(0);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toContain('src="blob:preview"');
    expect(upload).toHaveBeenCalledWith(file);

    resolveUpload("https://cdn.example/photo.png");
    await vi.waitFor(() => expect(updates).toHaveLength(1));

    expect(updates[0]?.content).toContain("https://cdn.example/photo.png");
    expect(updates[0]?.content).not.toContain("blob:preview");
    expect(updates[0]?.persist).toBeUndefined();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("removes the local preview when the upload returns no URL", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failed");
    const applyLocalContentUpdate = vi.fn();
    const upload = vi.fn(async () => "");
    const replacePreviewContent = vi.fn();

    runPastedImageFiles(
      args(applyLocalContentUpdate, replacePreviewContent, upload),
      [file],
      { fileId: "screen-1", point: { x: 0, y: 0 } },
    );
    await vi.waitFor(() =>
      expect(replacePreviewContent).toHaveBeenCalledTimes(2),
    );

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(replacePreviewContent.mock.calls[1]?.[0]).not.toContain(
      "blob:failed",
    );
  });

  it("commits the hosted URL when the live preview is not in durable content", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:live");
    let resolveUpload!: (url: string) => void;
    const upload = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    let livePreviewContent: string | null = null;
    const replacePreviewContent = vi.fn((content: string) => {
      livePreviewContent = content;
    });
    const applyLocalContentUpdate = vi.fn();

    runPastedImageFiles(
      args(
        applyLocalContentUpdate,
        replacePreviewContent,
        upload,
        () => "<main></main>",
        () => livePreviewContent,
      ),
      [file],
      { fileId: "screen-1", point: { x: 0, y: 0 } },
    );

    resolveUpload("https://cdn.example/live.png");
    await vi.waitFor(() => expect(applyLocalContentUpdate).toHaveBeenCalled());

    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toContain(
      "https://cdn.example/live.png",
    );
  });

  it("does not resurrect a preview deleted while its upload is pending", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:deleted");
    const applyLocalContentUpdate = vi.fn();
    let resolveUpload!: (url: string) => void;
    const upload = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    let previewContent: string | null = null;
    const replacePreviewContent = vi.fn((content: string) => {
      previewContent = content;
    });

    runPastedImageFiles(
      args(
        applyLocalContentUpdate,
        replacePreviewContent,
        upload,
        () => "<main></main>",
        () => previewContent,
      ),
      [file],
      { fileId: "screen-1", point: { x: 0, y: 0 } },
    );

    await vi.waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    await vi.waitFor(() =>
      expect(replacePreviewContent).toHaveBeenCalledOnce(),
    );
    previewContent = "<main></main>";
    resolveUpload("https://cdn.example/deleted.png");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(previewContent).toBe("<main></main>");
  });
});

describe("replacePastedImageSource", () => {
  it("changes only the image source for the inserted node", () => {
    const content =
      '<main><img data-agent-native-node-id="image-1" src="blob:preview" /></main>';

    const replaced = replacePastedImageSource(
      content,
      "image-1",
      "https://cdn.example/image.png",
    );

    expect(replaced).toContain('src="https://cdn.example/image.png"');
    expect(replaced).not.toContain("blob:preview");
  });
});
