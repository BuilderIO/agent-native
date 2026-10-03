// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bitmapSizes: new WeakMap<Blob, { width: number; height: number }>(),
  createSinglePageRasterPdf: vi.fn(),
  outputCanvasSizes: [] as Array<{ width: number; height: number }>,
  renderNativeExportPng: vi.fn(),
}));

vi.mock("../native-export-render", () => ({
  renderNativeExportPng: mocks.renderNativeExportPng,
}));
vi.mock("@/pages/design-editor/export-capture", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/pages/design-editor/export-capture")
    >();
  return {
    ...actual,
    createSinglePageRasterPdf: mocks.createSinglePageRasterPdf,
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { getExportCompositeBounds } from "../export-capture";
import type { PngCaptureScope } from "../png-export-render";
import { runDownloadPdf } from "./download-pdf";
import {
  resolveSelectedScreenExportFrames,
  runRenderPngBlob,
} from "./render-png-blob";

const originalDimensions = [
  [document.documentElement, "scrollWidth"],
  [document.documentElement, "scrollHeight"],
  [document.body, "scrollWidth"],
  [document.body, "scrollHeight"],
] as const;
const originalDimensionDescriptors = originalDimensions.map(
  ([target, key]) => ({
    descriptor: Object.getOwnPropertyDescriptor(target, key),
    key,
    target,
  }),
);

function createReportedBoardFixture() {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-design-preview-iframe", "");
  Object.defineProperties(iframe, {
    clientHeight: { configurable: true, value: 8191 },
    clientWidth: { configurable: true, value: 8192 },
  });
  document.body.append(iframe);

  for (const [target, key] of originalDimensions) {
    Object.defineProperty(target, key, {
      configurable: true,
      value: key === "scrollWidth" ? 8192 : 8191,
    });
  }

  const nodeRects = [
    { left: 4096, top: 4096, width: 190, height: 154 },
    { left: 4613, top: 4096, width: 160, height: 12 },
    { left: 4287, top: 4046, width: 273, height: 133 },
    { left: 4434, top: 4139, width: 68, height: 72 },
    { left: 4410, top: 4246, width: 72, height: 3 },
    { left: 4579, top: 4096, width: 34, height: 95 },
  ];
  for (const [index, rect] of nodeRects.entries()) {
    const node = document.createElement("div");
    node.dataset.agentNativeNodeId = `reported-node-${index}`;
    node.getBoundingClientRect = () =>
      ({
        ...rect,
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(node);
  }

  return { doc: document, iframe };
}

function renderArgs(fixture: ReturnType<typeof createReportedBoardFixture>) {
  return {
    activeCanvasSourceType: "inline" as const,
    canEditDesign: true,
    canvasFrameGeometryById: {},
    overviewScreens: [],
    resolvePngCaptureTarget: () => ({
      cropSelection: null,
      doc: fixture.doc,
      iframe: fixture.iframe,
    }),
    selectedScreenIds: [],
    viewMode: "overview" as const,
  };
}

describe("board document exports", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    mocks.bitmapSizes = new WeakMap();
    mocks.outputCanvasSizes.length = 0;
    mocks.renderNativeExportPng.mockReset();
    mocks.renderNativeExportPng.mockImplementation(
      async (args: {
        width: number;
        height: number;
        scale: number;
        clip?: { width: number; height: number };
      }) => {
        const blob = new Blob(["png"], { type: "image/png" });
        mocks.bitmapSizes.set(blob, {
          width: Math.ceil((args.clip?.width ?? args.width) * args.scale),
          height: Math.ceil((args.clip?.height ?? args.height) * args.scale),
        });
        return blob;
      },
    );
    vi.stubGlobal("createImageBitmap", async (blob: Blob) => ({
      ...mocks.bitmapSizes.get(blob),
      close: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, callback, type) {
        mocks.outputCanvasSizes.push({
          width: this.width,
          height: this.height,
        });
        callback(new Blob(["image"], { type }));
      },
    );
    mocks.createSinglePageRasterPdf.mockReset();
    mocks.createSinglePageRasterPdf.mockResolvedValue(
      new Blob(["pdf"], { type: "application/pdf" }),
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const { descriptor, key, target } of originalDimensionDescriptors) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  });

  it("frames the reported board's artwork in PNG and PDF instead of the 8192px preview window", async () => {
    const fixture = createReportedBoardFixture();
    const args = renderArgs(fixture);

    const png = await runRenderPngBlob(args, {
      scope: "document",
      settings: { scale: 1 },
    });

    expect(png.type).toBe("image/png");
    expect(mocks.renderNativeExportPng).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: 8192,
        height: 8191,
        scale: 1,
        clip: { x: 4080, y: 4030, width: 709, height: 236 },
      }),
    );
    expect(mocks.outputCanvasSizes[mocks.outputCanvasSizes.length - 1]).toEqual(
      { width: 709, height: 236 },
    );

    await runDownloadPdf(
      {
        fallbackExportName: () => "Test - Export.pdf",
        pngExportingRef: { current: false },
        renderPngBlob: (arg) => runRenderPngBlob(args, arg),
        resolveSelectedScreensBounds: () => null,
        resolvePngCaptureTarget: args.resolvePngCaptureTarget,
        setPngExporting: vi.fn(),
        showRasterCaptureError: vi.fn(),
        t: () => "PDF downloaded",
        triggerBlobDownload: vi.fn(),
      },
      { scale: 1 },
    );

    expect(mocks.createSinglePageRasterPdf).toHaveBeenCalledWith(
      expect.objectContaining({ width: 709, height: 236 }),
    );
  });

  it("exports the selected overview screen to PDF from its screen iframe", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-screen-iframe-id", "screen-1");
    Object.defineProperties(iframe, {
      clientHeight: { configurable: true, value: 200 },
      clientWidth: { configurable: true, value: 320 },
    });
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = "<main>Selected screen</main>";

    const context = {
      drawImage: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback, type) =>
        callback(new Blob(["image"], { type })),
      );

    try {
      const events: string[] = [];
      const args = {
        ...renderArgs({ doc: iframe.contentDocument!, iframe }),
        overviewScreens: [
          { id: "screen-1", width: 320, height: 200 },
        ] as never[],
        releaseScreenFromExport: vi.fn(() => events.push("release")),
        selectedScreenIds: ["screen-1"],
      };
      args.resolvePngCaptureTarget = vi.fn(() => {
        events.push("target:screen-1");
        return {
          cropSelection: null,
          doc: iframe.contentDocument!,
          iframe,
        };
      });
      const resolvePngCaptureTarget = vi.fn(() => ({
        cropSelection: null,
        doc: iframe.contentDocument!,
        iframe,
      }));

      await runDownloadPdf(
        {
          fallbackExportName: () => "Test - Export.pdf",
          pngExportingRef: { current: false },
          renderPngBlob: (arg) => runRenderPngBlob(args, arg),
          resolveSelectedScreensBounds: () => null,
          resolvePngCaptureTarget,
          setPngExporting: vi.fn(),
          showRasterCaptureError: vi.fn(),
          t: () => "PDF downloaded",
          triggerBlobDownload: vi.fn(),
        },
        { scale: 1 },
        "screens",
      );

      expect(args.resolvePngCaptureTarget).toHaveBeenCalledWith(
        "screens",
        "screen-1",
      );
      expect(resolvePngCaptureTarget).toHaveBeenCalledWith("screens");
      expect(args.releaseScreenFromExport).toHaveBeenCalledOnce();
      expect(events).toEqual(["target:screen-1", "release"]);
      expect(mocks.renderNativeExportPng).toHaveBeenCalledOnce();
      expect(mocks.renderNativeExportPng).toHaveBeenCalledWith(
        expect.objectContaining({
          clip: { x: 0, y: 0, width: 320, height: 200 },
        }),
      );
      expect(mocks.createSinglePageRasterPdf).toHaveBeenCalledWith(
        expect.objectContaining({ width: 320, height: 200 }),
      );
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }
  });

  it("renders multiple selected screens before resolving a single-frame PDF target", async () => {
    const screens = [
      { id: "screen-a", width: 320, height: 200 },
      { id: "screen-b", width: 400, height: 240 },
    ] as never[];
    const geometries = {
      "screen-a": { x: 0, y: 0, width: 320, height: 200, z: 0 },
      "screen-b": { x: 400, y: 0, width: 400, height: 240, z: 1 },
    } as never;
    const selectedScreenIds = ["screen-a", "screen-b"];
    const iframes = selectedScreenIds.map((id) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("data-screen-iframe-id", id);
      Object.defineProperties(iframe, {
        clientHeight: {
          configurable: true,
          value: id === "screen-a" ? 200 : 240,
        },
        clientWidth: {
          configurable: true,
          value: id === "screen-a" ? 320 : 400,
        },
      });
      document.body.append(iframe);
      iframe.contentDocument!.body.innerHTML = `<main>${id}</main>`;
      return iframe;
    });
    const context = {
      drawImage: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback, type) =>
        callback(new Blob(["image"], { type })),
      );
    const iframeById = new Map(
      iframes.map((iframe, index) => [selectedScreenIds[index]!, iframe]),
    );
    const resolvePngCaptureTarget = vi.fn(
      (_scope: PngCaptureScope, screenId?: string) => {
        const iframe = screenId ? iframeById.get(screenId) : undefined;
        const doc = iframe?.contentDocument;
        if (!iframe || !doc)
          throw new Error("A selected screen preview is unavailable");
        return { cropSelection: null, doc, iframe };
      },
    );
    const captureArgs = {
      activeCanvasSourceType: "inline" as const,
      canEditDesign: true,
      canvasFrameGeometryById: geometries,
      overviewScreens: screens,
      resolvePngCaptureTarget,
      selectedScreenIds,
      viewMode: "overview" as const,
    };
    const resolveSelectedScreensBounds = () => {
      const selectedFrames = resolveSelectedScreenExportFrames({
        selectedScreenIds,
        overviewScreens: screens,
        canvasFrameGeometryById: geometries,
        iframeSizeById: new Map(
          iframes.map((iframe, index) => [
            selectedScreenIds[index]!,
            { width: iframe.clientWidth, height: iframe.clientHeight },
          ]),
        ),
      });
      return getExportCompositeBounds(selectedFrames.map(({ frame }) => frame));
    };

    try {
      await runDownloadPdf(
        {
          fallbackExportName: () => "Test - Export.pdf",
          pngExportingRef: { current: false },
          renderPngBlob: (arg) => runRenderPngBlob(captureArgs, arg),
          resolveSelectedScreensBounds,
          resolvePngCaptureTarget,
          setPngExporting: vi.fn(),
          showRasterCaptureError: vi.fn(),
          t: () => "PDF downloaded",
          triggerBlobDownload: vi.fn(),
        },
        { scale: 1 },
        "screens",
      );

      expect(resolvePngCaptureTarget).toHaveBeenNthCalledWith(
        1,
        "screens",
        "screen-a",
      );
      expect(resolvePngCaptureTarget).toHaveBeenNthCalledWith(
        2,
        "screens",
        "screen-b",
      );
      expect(mocks.renderNativeExportPng).toHaveBeenCalledTimes(2);
      expect(mocks.createSinglePageRasterPdf).toHaveBeenCalledWith(
        expect.objectContaining({ width: 800, height: 240 }),
      );
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }
  });

  it("leaves ordinary screen document exports uncropped", async () => {
    const fixture = createReportedBoardFixture();
    fixture.iframe.setAttribute("data-screen-iframe-id", "screen-1");

    await runRenderPngBlob(renderArgs(fixture), { scope: "document" });

    expect(mocks.renderNativeExportPng).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 8192, height: 8191 }),
    );
    expect(
      mocks.outputCanvasSizes[mocks.outputCanvasSizes.length - 1]!.width,
    ).toBeGreaterThan(8000);
    expect(
      mocks.outputCanvasSizes[mocks.outputCanvasSizes.length - 1]!.height,
    ).toBeGreaterThan(8000);
  });

  it("keeps source placeholder rules in the native renderer snapshot", async () => {
    const fixture = createReportedBoardFixture();
    const style = fixture.doc.createElement("style");
    style.textContent =
      'input::placeholder { color: rgb(148, 163, 184); font-family: "PlaceholderFont"; font-size: 14px; font-style: italic; font-weight: 600; line-height: 20px; }';
    const input = fixture.doc.createElement("input");
    input.placeholder = "Search movies";
    fixture.doc.head.append(style);
    fixture.doc.body.append(input);

    await runRenderPngBlob(renderArgs(fixture), { scope: "document" });

    const calls = mocks.renderNativeExportPng.mock.calls;
    const html = calls[calls.length - 1]?.[0].html;
    expect(html).toContain("input::placeholder");
    expect(html).toContain('font-family: "PlaceholderFont"');
    expect(html).toContain("font-size: 14px");
  });

  it("uses the live responsive image source without retaining picture srcsets", async () => {
    const fixture = createReportedBoardFixture();
    const picture = fixture.doc.createElement("picture");
    const source = fixture.doc.createElement("source");
    source.setAttribute("srcset", "https://images.example.test/large.webp");
    const image = fixture.doc.createElement("img");
    image.setAttribute("src", "https://images.example.test/fallback.png");
    image.setAttribute("srcset", "https://images.example.test/other.png 2x");
    Object.defineProperty(image, "currentSrc", {
      configurable: true,
      value: "https://images.example.test/chosen.webp",
    });
    picture.append(source, image);
    fixture.doc.body.append(picture);

    await runRenderPngBlob(renderArgs(fixture), { scope: "document" });

    const calls = mocks.renderNativeExportPng.mock.calls;
    const html = calls[calls.length - 1]?.[0].html;
    expect(html).toContain('src="https://images.example.test/chosen.webp"');
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("<source");
    expect(html).not.toContain("fallback.png");
  });
});
