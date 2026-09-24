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

import { findScreenFrameAtCanvasPoint } from "../overview-camera";
import type { DesignFile } from "../types";
import {
  canvasPointFromClient,
  pngDensityScale,
  getOverviewCanvasCenter,
  replacePastedMediaSource,
  runPastedImageFiles,
  type PastedImageFilesArgs,
} from "./pasted-image-files";

class DecodedImage {
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
  onload?: () => void;
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
  uploadMediaFileForHtml: PastedImageFilesArgs["uploadMediaFileForHtml"],
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
    uploadMediaFileForHtml,
    viewModeRef: ref("single"),
    zoom: 100,
  };
}

const file = new File(["image"], "photo.png", { type: "image/png" });

describe("canvasPointFromClient", () => {
  it("removes surface padding when mapping overview paste anchors", () => {
    const surface = document.createElement("div");
    surface.dataset.multiScreenCanvasSurface = "";
    const world = document.createElement("div");
    world.dataset.multiScreenCanvasWorld = "";
    world.style.transform = "matrix(2, 0, 0, 2, -300, -200)";
    surface.append(world);
    document.body.append(surface);
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      right: 900,
      bottom: 650,
      width: 800,
      height: 600,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    } as DOMRect);

    const frames = [
      { id: "origin", geometry: { x: 0, y: 0, width: 1000, height: 1000 } },
    ];
    const origin = canvasPointFromClient(
      { clientX: 280, clientY: 330 },
      frames,
    );
    expect(origin).toEqual({ x: 0, y: 0 });
    expect(findScreenFrameAtCanvasPoint(origin!, frames)?.id).toBe("origin");

    expect(
      canvasPointFromClient({ clientX: 1480, clientY: 1230 }, frames),
    ).toEqual({ x: 600, y: 450 });
    surface.remove();
  });
});

describe("runPastedImageFiles", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", DecodedImage);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 160, height: 90, close: vi.fn() })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("inserts at the copied image's intrinsic size before replacing its URL", async () => {
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
    expect(previews[0]).toContain("width: 160px");
    expect(previews[0]).toContain("height: 90px");
    expect(upload).toHaveBeenCalledWith(file);

    resolveUpload("https://cdn.example/photo.png");
    await vi.waitFor(() => expect(updates).toHaveLength(1));

    expect(updates[0]?.content).toContain("https://cdn.example/photo.png");
    expect(updates[0]?.content).toContain("width: 160px");
    expect(updates[0]?.content).toContain("height: 90px");
    expect(updates[0]?.content).not.toContain("blob:preview");
    expect(updates[0]?.persist).toBeUndefined();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("preserves a small 17 by 9 image's native dimensions", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:small-icon");
    const previews: string[] = [];
    const replacePreviewContent = vi.fn((content: string) => {
      previews.push(content);
    });
    const applyLocalContentUpdate = vi.fn();
    const upload = vi.fn(async () => "https://cdn.example/small-icon.png");
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 17, height: 9, close: vi.fn() })),
    );

    runPastedImageFiles(
      args(applyLocalContentUpdate, replacePreviewContent, upload),
      [file],
      { fileId: "screen-1", point: { x: 20, y: 30 } },
    );

    await vi.waitFor(() => expect(applyLocalContentUpdate).toHaveBeenCalled());
    expect(previews[0]).toContain("width: 17px");
    expect(previews[0]).toContain("height: 9px");
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toContain("width: 17px");
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toContain("height: 9px");
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
    await vi.waitFor(() => expect(upload).toHaveBeenCalled());
    resolveUpload("https://cdn.example/deleted.png");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(previewContent).toBe("<main></main>");
  });

  it("inserts video at its intrinsic size and replaces the blob URL", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:preview-video");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const nativeCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = nativeCreateElement(tagName);
      if (tagName.toLowerCase() === "video") {
        Object.defineProperty(element, "videoWidth", { value: 640 });
        Object.defineProperty(element, "videoHeight", { value: 360 });
        (element as unknown as HTMLVideoElement).load = () => {
          queueMicrotask(() =>
            element.dispatchEvent(new Event("loadedmetadata")),
          );
        };
      }
      return element;
    });
    const videoFile = new File(["video"], "prototype.mp4", {
      type: "video/mp4",
    });
    let currentContent = "<main></main>";
    const replacePreviewContent = vi.fn((content: string) => {
      currentContent = content;
    });
    const applyLocalContentUpdate = vi.fn((content: string) => {
      currentContent = content;
    });

    runPastedImageFiles(
      args(
        applyLocalContentUpdate,
        replacePreviewContent,
        vi.fn(async () => "https://cdn.example/prototype.mp4"),
        () => currentContent,
      ),
      [videoFile],
      { fileId: "screen-1", point: { x: 15, y: 25 } },
    );

    await vi.waitFor(() =>
      expect(applyLocalContentUpdate).toHaveBeenCalledOnce(),
    );
    expect(createObjectURL).toHaveBeenCalledWith(videoFile);
    expect(replacePreviewContent.mock.calls[0]?.[0]).toContain(
      '<video src="blob:preview-video"',
    );
    expect(currentContent).toContain('src="https://cdn.example/prototype.mp4"');
    expect(currentContent).toContain("width: 640px");
    expect(currentContent).toContain("height: 360px");
    expect(currentContent).not.toContain("blob:preview-video");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-video");
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

describe("replacePastedMediaSource", () => {
  it("changes only the image source for the inserted node", () => {
    const content =
      '<main><img data-agent-native-node-id="image-1" src="blob:preview" /></main>';

    const replaced = replacePastedMediaSource(
      content,
      "image-1",
      "https://cdn.example/image.png",
    );

    expect(replaced).toContain('src="https://cdn.example/image.png"');
    expect(replaced).not.toContain("blob:preview");
  });

  it("changes or removes only the video with the matching node id", () => {
    const content =
      '<main><video data-agent-native-node-id="video-1" src="blob:one"></video><video data-agent-native-node-id="video-2" src="blob:two"></video></main>';

    const replaced = replacePastedMediaSource(
      content,
      "video-1",
      "https://cdn.example/video.mp4",
    );
    expect(replaced).toContain('src="https://cdn.example/video.mp4"');
    expect(replaced).toContain('src="blob:two"');

    const removed = replacePastedMediaSource(replaced, "video-2", null);
    expect(removed).toContain('src="https://cdn.example/video.mp4"');
    expect(removed).not.toContain('src="blob:two"');
  });
});

describe("overview paste placement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("maps the viewport center through overview pan and zoom before targeting a Screen", async () => {
    class MatrixStub {
      a: number;
      e: number;
      f: number;

      constructor(transform?: string) {
        const values = /^matrix\(([^)]+)\)$/
          .exec(transform ?? "")?.[1]
          ?.split(/\s*,\s*/)
          .map(Number) ?? [1, 0, 0, 1, 0, 0];
        this.a = values[0] ?? 1;
        this.e = values[4] ?? 0;
        this.f = values[5] ?? 0;
      }
    }
    vi.stubGlobal("DOMMatrixReadOnly", MatrixStub);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 160, height: 90, close: vi.fn() })),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:overview-paste");

    const container = document.createElement("div");
    const world = document.createElement("div");
    world.setAttribute("data-multi-screen-canvas-world", "");
    world.style.transform = "matrix(2, 0, 0, 2, -680, -480)";
    container.append(world);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 50,
      top: 70,
      right: 850,
      bottom: 670,
      width: 800,
      height: 600,
      x: 50,
      y: 70,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.append(container);

    expect(getOverviewCanvasCenter(container)).toEqual({ x: 300, y: 150 });

    world.style.transform = "matrix(0.5, 0, 0, 0.5, 120, 40)";
    expect(getOverviewCanvasCenter(container)).toEqual({ x: 320, y: 280 });
    world.style.transform = "matrix(2, 0, 0, 2, -680, -480)";

    const applyLocalContentUpdate = vi.fn();
    const selectInsertedLayers = vi.fn();
    const pasteArgs = args(
      applyLocalContentUpdate,
      vi.fn(),
      vi.fn(async () => "https://cdn.example/photo.png"),
    );
    pasteArgs.canvasContainerRef = ref(container);
    pasteArgs.boardFileId = "board-1";
    pasteArgs.viewModeRef = ref("overview");
    pasteArgs.overviewScreens = [
      {
        id: "origin",
        filename: "origin.html",
        content: "<main></main>",
        updatedAt: "",
        heightPinned: false,
        width: 1000,
        height: 1000,
      },
      {
        id: "screen-1",
        filename: "screen.html",
        content: "<main></main>",
        updatedAt: "",
        heightPinned: false,
        width: 1000,
        height: 1000,
      },
    ];
    pasteArgs.canvasFrameGeometryById = {
      origin: { x: 0, y: 0, width: 1000, height: 1000 },
      "screen-1": { x: 200, y: 50, width: 1000, height: 1000 },
    };
    pasteArgs.selectInsertedLayers = selectInsertedLayers;
    pasteArgs.getScreenContent = () => "<main></main>";
    pasteArgs.overviewSelectedScreenIds = ["screen-1"];

    expect(runPastedImageFiles(pasteArgs, [file])).toBe(true);
    await vi.waitFor(() => expect(applyLocalContentUpdate).toHaveBeenCalled());

    const insertedContent = applyLocalContentUpdate.mock.calls[0]?.[0];
    const insertedImage = new DOMParser()
      .parseFromString(insertedContent ?? "", "text/html")
      .querySelector<HTMLImageElement>('img[alt="photo.png"]');
    expect(selectInsertedLayers).toHaveBeenCalledWith(
      "screen-1",
      expect.any(String),
      expect.any(Array),
    );
    expect(insertedImage?.style.left).toBe("420px");
    expect(insertedImage?.style.top).toBe("455px");
  });
});
