// @vitest-environment happy-dom

import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/svg-paste", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/svg-paste")>()),
  buildPastedSvgLayer: (markup: string, name: string) =>
    markup.includes("<path")
      ? {
          html: `<div data-agent-native-node-id="svg-frame" data-agent-native-layer-name="${name}" data-an-primitive="frame" style="position:absolute;width:118px;height:24px"></div>`,
          width: 118,
          height: 24,
        }
      : null,
}));

import type { DesignFile } from "../types";
import {
  pngDensityScale,
  replacePastedImageSource,
  runPastedImageFiles,
  type PastedImageFilesArgs,
} from "./pasted-image-files";

class DecodedImage {
  src = "";
  naturalWidth = 132;
  naturalHeight = 80;
  decode() {
    return Promise.resolve();
  }
}

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
    getVisibleCanvasRect: () => null,
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
  beforeEach(() => {
    vi.stubGlobal("Image", DecodedImage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    await vi.waitFor(() => expect(previews).toHaveLength(1));
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(updates).toHaveLength(0);
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

    await vi.waitFor(() => expect(upload).toHaveBeenCalled());
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

describe("runPastedImageFiles durable base", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", DecodedImage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not write a stale live preview back over a later reparent", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stale");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const durable =
      '<main><div data-agent-native-node-id="board-frame"><div data-agent-native-node-id="icon"></div></div></main>';
    const stalePreview =
      '<main><div data-agent-native-node-id="board-frame"></div><div data-agent-native-node-id="icon"></div></main>';
    let preview = stalePreview;
    const applyLocalContentUpdate = vi.fn();

    runPastedImageFiles(
      args(
        applyLocalContentUpdate,
        (content: string) => {
          preview = content;
        },
        async () => "https://cdn.example/photo.png",
        () => durable,
        () => preview,
      ),
      [file],
      { fileId: "screen-1", point: { x: 0, y: 0 } },
    );

    await vi.waitFor(() => expect(applyLocalContentUpdate).toHaveBeenCalled());
    const written = new DOMParser().parseFromString(
      applyLocalContentUpdate.mock.calls[0]![0] as string,
      "text/html",
    );
    expect(
      written.querySelector('[data-agent-native-node-id="icon"]')!.parentElement
        ?.dataset.agentNativeNodeId,
    ).toBe("board-frame");
    expect(written.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/photo.png",
    );
  });
});

describe("runPastedImageFiles placement", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", DecodedImage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pastes an image at its natural size, centred on the target point", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sized");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const previews: string[] = [];

    runPastedImageFiles(
      args(
        vi.fn(),
        (content: string) => previews.push(content),
        () => new Promise<string>(() => {}),
      ),
      [file],
      { fileId: "screen-1", point: { x: 960, y: 540 } },
    );

    await vi.waitFor(() => expect(previews).toHaveLength(1));
    const image = new DOMParser()
      .parseFromString(previews[0]!, "text/html")
      .querySelector<HTMLImageElement>("img")!;
    expect(image.style.width).toBe("132px");
    expect(image.style.height).toBe("80px");
    expect(image.style.left).toBe("894px");
    expect(image.style.top).toBe("500px");
  });

  it("pastes an SVG file as vector layers without uploading it", async () => {
    const upload = vi.fn(async () => "https://cdn.example/unused.png");
    const applyLocalContentUpdate = vi.fn();
    const svg = new File(
      ['<svg width="118" height="24"><path d="M0 0H10V10Z"/></svg>'],
      "builderLogo.svg",
      { type: "image/svg+xml" },
    );

    runPastedImageFiles(args(applyLocalContentUpdate, vi.fn(), upload), [svg], {
      fileId: "screen-1",
      point: { x: 960, y: 540 },
    });

    await vi.waitFor(() => expect(applyLocalContentUpdate).toHaveBeenCalled());
    const frame = new DOMParser()
      .parseFromString(
        applyLocalContentUpdate.mock.calls[0]![0] as string,
        "text/html",
      )
      .querySelector<HTMLElement>('[data-an-primitive="frame"]')!;
    expect(frame.dataset.agentNativeLayerName).toBe("builderLogo");
    expect(frame.style.left).toBe("901px");
    expect(frame.style.top).toBe("528px");
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("pngDensityScale", () => {
  const png = (chunks: Array<[string, number[]]>) => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (const [type, data] of chunks) {
      const length = data.length;
      bytes.push(
        length >>> 24,
        (length >>> 16) & 255,
        (length >>> 8) & 255,
        length & 255,
      );
      bytes.push(
        ...Array.from(type, (char) => char.charCodeAt(0)),
        ...data,
        0,
        0,
        0,
        0,
      );
    }
    return new Uint8Array(bytes);
  };
  const phys = (pixelsPerMetre: number) => {
    const b = [
      pixelsPerMetre >>> 24,
      (pixelsPerMetre >>> 16) & 255,
      (pixelsPerMetre >>> 8) & 255,
      pixelsPerMetre & 255,
    ];
    return [...b, ...b, 1];
  };

  it("halves a 144-dpi export", () => {
    expect(
      pngDensityScale(
        png([
          ["IHDR", Array(13).fill(0)],
          ["pHYs", phys(5669)],
          ["IDAT", [0]],
        ]),
      ),
    ).toBe(2);
  });

  it("keeps 72-dpi and density-less images at one image pixel per CSS pixel", () => {
    expect(
      pngDensityScale(
        png([
          ["pHYs", phys(2835)],
          ["IDAT", [0]],
        ]),
      ),
    ).toBe(1);
    expect(
      pngDensityScale(
        png([
          ["IHDR", Array(13).fill(0)],
          ["IDAT", [0]],
        ]),
      ),
    ).toBe(1);
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
