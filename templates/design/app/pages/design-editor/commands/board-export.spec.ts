// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSinglePageRasterPdf: vi.fn(),
  html2canvas: vi.fn(),
}));

vi.mock("html2canvas", () => ({ default: mocks.html2canvas }));
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
vi.mock("../export-font-mirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export-font-mirror")>();
  return {
    ...actual,
    mirrorPreviewWebFonts: vi.fn().mockResolvedValue({
      dispose: vi.fn(),
      unreadableStylesheets: [],
    }),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { runDownloadPdf } from "./download-pdf";
import { runRenderPngBlob } from "./render-png-blob";

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

  // The six saved board elements, after the preview's +4096px content offset.
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
    mocks.html2canvas.mockReset();
    mocks.html2canvas.mockImplementation(
      async (
        _target: Element,
        options: { width: number; height: number; scale: number },
      ) =>
        ({
          width: Math.ceil(options.width * options.scale),
          height: Math.ceil(options.height * options.scale),
          toBlob: (callback: BlobCallback, type?: string) =>
            callback(new Blob(["image"], { type })),
        }) as HTMLCanvasElement,
    );
    mocks.createSinglePageRasterPdf.mockReset();
    mocks.createSinglePageRasterPdf.mockResolvedValue(
      new Blob(["pdf"], { type: "application/pdf" }),
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
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
    expect(mocks.html2canvas).toHaveBeenLastCalledWith(
      fixture.doc.documentElement,
      expect.objectContaining({
        x: 4080,
        y: 4030,
        width: 709,
        height: 236,
        windowWidth: 8192,
        windowHeight: 8191,
        scale: 1,
      }),
    );

    await runDownloadPdf(
      {
        fallbackExportName: () => "Test - Export.pdf",
        pngExportingRef: { current: false },
        renderPngBlob: (arg) => runRenderPngBlob(args, arg),
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

  it("leaves ordinary screen document exports uncropped", async () => {
    const fixture = createReportedBoardFixture();
    fixture.iframe.setAttribute("data-screen-iframe-id", "screen-1");

    await runRenderPngBlob(renderArgs(fixture), { scope: "document" });

    expect(mocks.html2canvas).toHaveBeenLastCalledWith(
      fixture.doc.documentElement,
      expect.not.objectContaining({ x: 4080, y: 4030 }),
    );
  });

  it("copies placeholder text styles into the rasterized preview clone", async () => {
    const fixture = createReportedBoardFixture();
    const input = fixture.doc.createElement("input");
    input.placeholder = "Search movies";
    input.style.fontFamily = "TinyFont";
    input.style.fontSize = "1px";
    fixture.doc.body.append(input);

    const placeholderProperties: Record<string, string> = {
      color: "rgb(148, 163, 184)",
      "font-family": '"PlaceholderFont"',
      "font-size": "14px",
      "font-style": "italic",
      "font-weight": "600",
      "line-height": "20px",
    };
    const placeholderStyle = {
      getPropertyValue: (property: string) =>
        placeholderProperties[property] ?? "",
    } as CSSStyleDeclaration;
    const view = fixture.doc.defaultView!;
    const getComputedStyle = view.getComputedStyle.bind(view);
    const getComputedStyleSpy = vi
      .spyOn(view, "getComputedStyle")
      .mockImplementation(((element, pseudoElement) => {
        if (element === input && pseudoElement === "::placeholder") {
          return placeholderStyle;
        }
        return getComputedStyle(element, pseudoElement);
      }) as typeof view.getComputedStyle);

    try {
      await runRenderPngBlob(renderArgs(fixture), { scope: "document" });
      const lastCall =
        mocks.html2canvas.mock.calls[mocks.html2canvas.mock.calls.length - 1];
      const options = lastCall?.[1] as unknown as {
        onclone: (clonedDocument: Document) => void;
      };
      const clonedDocument = document.implementation.createHTMLDocument();
      clonedDocument.documentElement.innerHTML =
        fixture.doc.documentElement.innerHTML;

      options.onclone(clonedDocument);

      const clonedInput = clonedDocument.querySelector("input")!;
      expect(clonedInput.style.fontFamily).toBe("PlaceholderFont");
      expect(clonedInput.style.fontSize).toBe("14px");
      expect(clonedInput.style.color).toBe("rgb(148, 163, 184)");
      expect(clonedInput.style.lineHeight).toBe("20px");
    } finally {
      getComputedStyleSpy.mockRestore();
    }
  });
});
