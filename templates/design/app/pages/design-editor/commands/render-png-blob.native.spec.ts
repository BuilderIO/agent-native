// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const nativeCapture = vi.hoisted(() =>
  vi.fn(async () => new Blob(["native pixels"], { type: "image/png" })),
);
const renderDocument = vi.hoisted(() => vi.fn());
vi.mock("@/pages/design-editor/native-current-frame-png", () => ({
  captureNativeCurrentFramePng: nativeCapture,
}));
vi.mock("@/pages/design-editor/png-export-render", async (original) => ({
  ...(await original<
    typeof import("@/pages/design-editor/png-export-render")
  >()),
  resolveExportCropTarget: vi.fn(() => ({
    kind: "rect",
    rect: { x: 4064, y: 3283, width: 1510, height: 270 },
  })),
  renderExportDocumentCanvas: renderDocument,
}));
import type { ElementInfo } from "@/components/design/types";

import { runRenderPngBlob } from "./render-png-blob";

afterEach(() => vi.clearAllMocks());

it("exports one selected native overview screen from its own file", async () => {
  const iframe = document.createElement("iframe");
  Object.defineProperties(iframe, {
    clientWidth: { value: 320 },
    clientHeight: { value: 200 },
  });
  document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML =
    '<script type="application/x-agent-native-effects">{}</script>';
  const bitmap = { close: vi.fn(), width: 640, height: 400 };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(new Blob(["selected"], { type: "image/png" })),
  );
  try {
    const png = await runRenderPngBlob(
      {
        designId: "design",
        fileId: "active-board",
        activeCanvasSourceType: "inline",
        canEditDesign: true,
        canvasFrameGeometryById: {},
        overviewScreens: [{ id: "screen", width: 320, height: 200 }] as never[],
        selectedScreenIds: ["screen"],
        viewMode: "overview",
        resolvePngCaptureTarget: async () => ({
          iframe,
          doc: iframe.contentDocument!,
          cropSelection: null,
        }),
      },
      { scope: "screens", settings: { scale: 2 } },
    );
    expect(await png.text()).toBe("selected");
    expect(nativeCapture).toHaveBeenCalledExactlyOnceWith({
      designId: "design",
      fileId: "screen",
      iframe,
      pixelRatio: 2,
      cropRect: { x: 0, y: 0, width: 320, height: 200 },
    });
    expect(renderDocument).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(bitmap, -320, -200, 640, 400);
    expect(bitmap.close).toHaveBeenCalledOnce();
  } finally {
    iframe.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("composes selected native and DOM screens in frame order at the requested density", async () => {
  const nativeIframe = document.createElement("iframe");
  const domIframe = document.createElement("iframe");
  for (const iframe of [nativeIframe, domIframe]) {
    Object.defineProperties(iframe, {
      clientWidth: { value: 320 },
      clientHeight: { value: 200 },
    });
    document.body.append(iframe);
  }
  nativeIframe.contentDocument!.body.innerHTML =
    '<script type="application/x-agent-native-effects">{}</script>';
  domIframe.contentDocument!.body.innerHTML = "<main>DOM screen</main>";
  const domCanvas = document.createElement("canvas");
  renderDocument.mockResolvedValue({ canvas: domCanvas });
  const bitmap = { close: vi.fn(), width: 640, height: 400 };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  const context = {
    drawImage: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(new Blob(["composite"], { type: "image/png" })),
  );
  const releaseScreenFromExport = vi.fn();
  const nativeLease = Symbol("native");
  const domLease = Symbol("dom");
  try {
    const png = await runRenderPngBlob(
      {
        designId: "design",
        fileId: "unrelated-active-file",
        activeCanvasSourceType: "inline",
        canEditDesign: true,
        canvasFrameGeometryById: {
          native: { x: 400, y: 0, width: 320, height: 200, z: 2 },
          dom: { x: 0, y: 0, width: 320, height: 200, z: 1 },
        },
        overviewScreens: [
          { id: "native", width: 320, height: 200 },
          { id: "dom", width: 320, height: 200 },
        ] as never[],
        selectedScreenIds: ["native", "dom"],
        viewMode: "overview",
        releaseScreenFromExport,
        resolvePngCaptureTarget: async (_scope, screenId) =>
          screenId === "native"
            ? {
                iframe: nativeIframe,
                doc: nativeIframe.contentDocument!,
                cropSelection: null,
                screenLease: nativeLease,
              }
            : {
                iframe: domIframe,
                doc: domIframe.contentDocument!,
                cropSelection: null,
                screenLease: domLease,
              },
      },
      { scope: "screens", settings: { scale: 2 } },
    );
    expect(await png.text()).toBe("composite");
    expect(nativeCapture).toHaveBeenCalledExactlyOnceWith({
      designId: "design",
      fileId: "native",
      iframe: nativeIframe,
      pixelRatio: 2,
      cropRect: { x: 0, y: 0, width: 320, height: 200 },
    });
    expect(renderDocument).toHaveBeenCalledOnce();
    expect(context.drawImage.mock.calls.map(([source]) => source)).toEqual([
      domCanvas,
      bitmap,
    ]);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(releaseScreenFromExport).toHaveBeenCalledWith(nativeLease);
    expect(releaseScreenFromExport).toHaveBeenCalledWith(domLease);
  } finally {
    nativeIframe.remove();
    domIframe.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("releases native screen leases and decoded pixels when a later screen capture fails", async () => {
  const iframes = ["first", "second"].map((screenId) => {
    const iframe = document.createElement("iframe");
    iframe.dataset.screenIframeId = screenId;
    Object.defineProperties(iframe, {
      clientWidth: { value: 320 },
      clientHeight: { value: 200 },
    });
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML =
      '<script type="application/x-agent-native-effects">{}</script>';
    return iframe;
  });
  const bitmap = { close: vi.fn(), width: 320, height: 200 };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const leases = [Symbol("first"), Symbol("second")];
  const releaseScreenFromExport = vi.fn();
  const captureFailure = new Error("second scene changed");
  nativeCapture
    .mockResolvedValueOnce(new Blob(["first"], { type: "image/png" }))
    .mockRejectedValueOnce(captureFailure);
  try {
    await expect(
      runRenderPngBlob(
        {
          designId: "design",
          activeCanvasSourceType: "inline",
          canEditDesign: true,
          canvasFrameGeometryById: {},
          overviewScreens: [
            { id: "first", width: 320, height: 200 },
            { id: "second", width: 320, height: 200 },
          ] as never[],
          selectedScreenIds: ["first", "second"],
          viewMode: "overview",
          releaseScreenFromExport,
          resolvePngCaptureTarget: async (_scope, screenId) => {
            const index = screenId === "first" ? 0 : 1;
            return {
              iframe: iframes[index]!,
              doc: iframes[index]!.contentDocument!,
              cropSelection: null,
              screenLease: leases[index],
            };
          },
        },
        { scope: "screens", settings: { scale: 1 } },
      ),
    ).rejects.toBe(captureFailure);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(releaseScreenFromExport.mock.calls.map(([lease]) => lease)).toEqual(
      leases,
    );
  } finally {
    for (const iframe of iframes) iframe.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("exports a selected native wrapper at its requested density without resizing the board viewport", async () => {
  const screenLease = Symbol("native export");
  const releaseScreenFromExport = vi.fn();
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  Object.defineProperties(iframe, {
    clientWidth: { value: 8192 },
    clientHeight: { value: 8192 },
  });
  iframe.contentDocument!.body.innerHTML =
    '<script type="application/x-agent-native-effects">{}</script><div data-agent-native-node-id="wrapper"></div>';
  const png = await runRenderPngBlob(
    {
      designId: "design",
      fileId: "board",
      activeCanvasSourceType: "inline",
      canEditDesign: true,
      canvasFrameGeometryById: {},
      overviewScreens: [],
      selectedScreenIds: [],
      viewMode: "overview",
      releaseScreenFromExport,
      resolvePngCaptureTarget: async () => ({
        iframe,
        doc: iframe.contentDocument!,
        cropSelection: { sourceId: "wrapper" } as unknown as ElementInfo,
        screenLease,
      }),
    },
    { scope: "element", settings: { scale: 1 } },
  );
  expect(await png.text()).toBe("native pixels");
  expect(nativeCapture).toHaveBeenCalledWith(
    expect.objectContaining({
      iframe,
      pixelRatio: 1,
      selectedNodeIds: ["wrapper"],
      cropRect: { x: 4064, y: 3283, width: 1510, height: 270 },
    }),
  );
  expect(iframe.clientWidth).toBe(8192);
  expect(releaseScreenFromExport).toHaveBeenCalledExactlyOnceWith(screenLease);
  iframe.remove();
});
