// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { renderSelectedNativeSceneBlob } from "@/pages/design-editor/native-scene-export-client";

import { runRenderPngBlob } from "./commands/render-png-blob";
import {
  PngCaptureError,
  renderExportDocumentCanvas,
  resolveExportCropTarget,
} from "./png-export-render";

vi.mock(
  "@/pages/design-editor/native-scene-export-client",
  async (importOriginal) => ({
    ...(await importOriginal()),
    renderSelectedNativeSceneBlob: vi.fn(
      async () => new Blob(["native"], { type: "image/png" }),
    ),
  }),
);

vi.mock("./commands/native-viewed-source-version", () => ({
  pinNativeViewedSource: () => ({
    expectedVersionHash: "fixture-version",
    assertStillViewed: () => undefined,
  }),
}));

function fakeCanvas(tag: string): HTMLCanvasElement {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    ),
    (character) => character.charCodeAt(0),
  );
  return {
    dataset: { tag },
    width: 1440,
    height: 900,
    toBlob: (callback: (blob: Blob | null) => void, type?: string) =>
      callback(new Blob([png], { type: type ?? "image/png" })),
  } as unknown as HTMLCanvasElement;
}

const cropCanvasToRect = vi.fn<
  typeof import("./png-export-render").cropCanvasToRect
>(() => fakeCanvas("cropped"));
vi.mock("./png-export-render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./png-export-render")>();
  return {
    ...actual,
    renderExportDocumentCanvas: vi.fn(async (args: { cropRect?: unknown }) => ({
      canvas: fakeCanvas(args.cropRect ? "cropped" : "full"),
      scale: 1,
    })),
    cropCanvasToRect: (...args: Parameters<typeof actual.cropCanvasToRect>) =>
      cropCanvasToRect(...args),
  };
});

function elementInfo(partial: Partial<ElementInfo>): ElementInfo {
  return { tagName: "DIV", ...partial } as ElementInfo;
}

function captureTarget(
  cropSelection: ElementInfo | readonly ElementInfo[] | null,
) {
  return () => ({
    cropSelection,
    doc: document,
    iframe: {
      clientWidth: 1440,
      clientHeight: 900,
      hasAttribute: () => true,
    } as unknown as HTMLIFrameElement,
  });
}

function renderArgs(
  cropSelection: ElementInfo | readonly ElementInfo[] | null,
) {
  return {
    activeCanvasSourceType: "inline" as const,
    canEditDesign: true,
    canvasFrameGeometryById: {},
    overviewScreens: [],
    resolvePngCaptureTarget: captureTarget(cropSelection),
    selectedScreenIds: ["screen-1"],
    viewMode: "single" as const,
  };
}

afterEach(() => {
  cropCanvasToRect.mockClear();
  vi.mocked(renderExportDocumentCanvas).mockClear();
  document.body.innerHTML = "";
  vi.mocked(renderSelectedNativeSceneBlob).mockClear();
});

describe("resolveExportCropTarget", () => {
  it("reports whole-screen for no selection", () => {
    expect(resolveExportCropTarget(document, null)).toEqual({
      kind: "whole-screen",
    });
    expect(resolveExportCropTarget(document, [])).toEqual({
      kind: "whole-screen",
    });
  });

  it("reports whole-screen for the screen root", () => {
    expect(
      resolveExportCropTarget(document, elementInfo({ tagName: "BODY" })),
    ).toEqual({ kind: "whole-screen" });
    expect(
      resolveExportCropTarget(document, elementInfo({ tagName: "html" })),
    ).toEqual({ kind: "whole-screen" });
  });

  it("reports unresolved for a selection missing from the live document", () => {
    expect(
      resolveExportCropTarget(
        document,
        elementInfo({ selector: "#not-in-this-document" }),
      ),
    ).toEqual({ kind: "unresolved" });
  });

  it("reports unresolved for a selection that measures empty", () => {
    const node = document.createElement("div");
    node.id = "empty-node";
    node.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    document.body.appendChild(node);

    expect(
      resolveExportCropTarget(
        document,
        elementInfo({ selector: "#empty-node" }),
      ),
    ).toEqual({ kind: "unresolved" });
  });

  it("unions the rects of a multi-element selection", () => {
    const first = document.createElement("div");
    first.id = "first";
    first.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 50 }) as DOMRect;
    const second = document.createElement("div");
    second.id = "second";
    second.getBoundingClientRect = () =>
      ({ left: 60, top: 20, width: 100, height: 80 }) as DOMRect;
    document.body.append(first, second);

    expect(
      resolveExportCropTarget(document, [
        elementInfo({ selector: "#first" }),
        elementInfo({ selector: "#second" }),
      ]),
    ).toEqual({
      kind: "rect",
      rect: { x: 10, y: 20, width: 150, height: 80 },
    });
  });

  it("widens to the whole screen when the root is part of the selection", () => {
    const node = document.createElement("div");
    node.id = "child";
    node.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 50 }) as DOMRect;
    document.body.appendChild(node);

    expect(
      resolveExportCropTarget(document, [
        elementInfo({ tagName: "BODY" }),
        elementInfo({ selector: "#child" }),
      ]),
    ).toEqual({ kind: "whole-screen" });
  });

  it("refuses a root selection when an ordinary selected member is unresolved", () => {
    expect(
      resolveExportCropTarget(document, [
        elementInfo({ tagName: "BODY" }),
        elementInfo({ selector: "#never-rendered" }),
      ]),
    ).toEqual({ kind: "unresolved" });
  });

  it("refuses a partly unresolvable ordinary selection instead of cropping a subset", () => {
    const painted = document.createElement("div");
    painted.id = "painted";
    painted.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 50 }) as DOMRect;
    document.body.appendChild(painted);

    expect(
      resolveExportCropTarget(document, [
        elementInfo({ selector: "#painted" }),
        elementInfo({ selector: "#never-rendered" }),
      ]),
    ).toEqual({ kind: "unresolved" });
  });
});

describe("runRenderPngBlob element scope", () => {
  it("passes a selected native frame's full mounted viewport and crop to the pixel renderer", async () => {
    const frame = document.createElement("div");
    frame.id = "board-frame";
    frame.setAttribute("data-agent-native-node-id", "frame-1");
    frame.getBoundingClientRect = () =>
      ({ left: 144, top: 6, width: 1162, height: 887 }) as DOMRect;
    document.body.append(frame);
    const manifest = document.createElement("script");
    manifest.type = "application/x-agent-native-effects";
    document.head.append(manifest);
    try {
      const blob = await runRenderPngBlob(
        {
          ...renderArgs(elementInfo({ selector: "#board-frame" })),
          designId: "owned-design",
          boardFileId: "board-file",
          resolvePngCaptureTarget: () => ({
            ...captureTarget(elementInfo({ selector: "#board-frame" }))(),
            sourceFileId: "board-file",
          }),
        },
        { scope: "element", settings: { scale: 1 } },
      );
      expect(blob.type).toBe("image/png");
      expect(renderSelectedNativeSceneBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          viewport: { width: 1162, height: 887 },
          sourceViewport: { width: 1440, height: 900 },
          crop: {
            x: 144,
            y: 6,
            width: 1162,
            height: 887,
            nodeId: "frame-1",
          },
        }),
      );
      expect(renderExportDocumentCanvas).not.toHaveBeenCalled();
    } finally {
      manifest.remove();
    }
  });
  it("refuses an off-viewport selected native frame before a pixel request", async () => {
    const frame = document.createElement("div");
    frame.id = "offscreen-frame";
    frame.setAttribute("data-agent-native-node-id", "offscreen-1");
    frame.getBoundingClientRect = () =>
      ({ left: 4314, top: 2069, width: 240, height: 160 }) as DOMRect;
    document.body.append(frame);
    const manifest = document.createElement("script");
    manifest.type = "application/x-agent-native-effects";
    document.head.append(manifest);
    try {
      await expect(
        runRenderPngBlob(
          {
            ...renderArgs(elementInfo({ selector: "#offscreen-frame" })),
            designId: "owned-design",
            boardFileId: "board-file",
            resolvePngCaptureTarget: () => ({
              ...captureTarget(elementInfo({ selector: "#offscreen-frame" }))(),
              sourceFileId: "board-file",
            }),
          },
          { scope: "element", settings: { scale: 1 } },
        ),
      ).rejects.toMatchObject({ code: "scene-unreadable" });
      expect(renderSelectedNativeSceneBlob).not.toHaveBeenCalled();
    } finally {
      manifest.remove();
    }
  });
  it("fences a mounted viewport resize after the selected source is pinned", async () => {
    const frame = document.createElement("div");
    frame.id = "resizing-frame";
    frame.setAttribute("data-agent-native-node-id", "resizing-1");
    frame.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 240, height: 160 }) as DOMRect;
    document.body.append(frame);
    const manifest = document.createElement("script");
    manifest.type = "application/x-agent-native-effects";
    document.head.append(manifest);
    let width = 1440;
    const iframe = {
      get clientWidth() {
        return width;
      },
      clientHeight: 900,
    } as unknown as HTMLIFrameElement;
    try {
      await runRenderPngBlob(
        {
          ...renderArgs(elementInfo({ selector: "#resizing-frame" })),
          designId: "owned-design",
          resolvePngCaptureTarget: () => ({
            cropSelection: elementInfo({ selector: "#resizing-frame" }),
            doc: document,
            iframe,
            sourceFileId: "board-file",
          }),
        },
        { scope: "element", settings: { scale: 1 } },
      );
      const call = vi.mocked(renderSelectedNativeSceneBlob).mock.lastCall?.[0];
      expect(call?.sourceViewport).toEqual({ width: 1440, height: 900 });
      expect(call?.assertStillViewed).toBeTypeOf("function");
      expect(() => call?.assertStillViewed?.()).not.toThrow();
      width = 1400;
      expect(() => call?.assertStillViewed?.()).toThrow(/viewport changed/);
    } finally {
      manifest.remove();
    }
  });
  it("renders the whole screen when the screen root is selected", async () => {
    const blob = await runRenderPngBlob(
      renderArgs(elementInfo({ tagName: "BODY" })),
      { scope: "element", settings: { scale: 1 } },
    );

    expect(blob.type).toBe("image/png");
    expect(renderExportDocumentCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ cropRect: null }),
    );
    expect(cropCanvasToRect).not.toHaveBeenCalled();
  });
  it("keeps a native whole-screen raster on the original viewport without a crop", async () => {
    const manifest = document.createElement("script");
    manifest.type = "application/x-agent-native-effects";
    document.head.append(manifest);
    try {
      const blob = await runRenderPngBlob(
        {
          ...renderArgs(elementInfo({ tagName: "BODY" })),
          designId: "owned-design",
          resolvePngCaptureTarget: () => ({
            ...captureTarget(elementInfo({ tagName: "BODY" }))(),
            sourceFileId: "board-file",
          }),
        },
        { scope: "element", settings: { scale: 1 } },
      );
      expect(blob.type).toBe("image/png");
      expect(renderSelectedNativeSceneBlob).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: { width: 1440, height: 900 } }),
      );
      const call = vi.mocked(renderSelectedNativeSceneBlob).mock.lastCall?.[0];
      expect(call?.crop).toBeUndefined();
      expect(call?.sourceViewport).toBeUndefined();
    } finally {
      manifest.remove();
    }
  });

  it("renders the whole screen when a selected root contains a selected child", async () => {
    const node = document.createElement("div");
    node.id = "child";
    document.body.appendChild(node);

    const blob = await runRenderPngBlob(
      renderArgs([
        elementInfo({ tagName: "BODY" }),
        elementInfo({ selector: "#child" }),
      ]),
      { scope: "element", settings: { scale: 1 } },
    );

    expect(blob.type).toBe("image/png");
    expect(renderExportDocumentCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ cropRect: null }),
    );
    expect(cropCanvasToRect).not.toHaveBeenCalled();
  });

  it("keeps empty element selections unresolved but allows an empty document capture", async () => {
    for (const cropSelection of [null, []] as const) {
      await expect(
        runRenderPngBlob(renderArgs(cropSelection), {
          scope: "element",
          settings: { scale: 1 },
        }),
      ).rejects.toMatchObject({ code: "selection-unresolved" });
    }

    const documentBlob = await runRenderPngBlob(renderArgs(null), {
      scope: "document",
      settings: { scale: 1 },
    });

    expect(documentBlob.type).toBe("image/png");
    expect(renderExportDocumentCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ cropRect: null }),
    );
    expect(cropCanvasToRect).not.toHaveBeenCalled();
  });

  it("crops to a resolvable element selection", async () => {
    const node = document.createElement("div");
    node.id = "card";
    node.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 50 }) as DOMRect;
    document.body.appendChild(node);

    const blob = await runRenderPngBlob(
      renderArgs(elementInfo({ selector: "#card" })),
      { scope: "element", settings: { scale: 1 } },
    );

    expect(blob.type).toBe("image/png");
    expect(renderExportDocumentCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        cropRect: { x: 10, y: 20, width: 100, height: 50 },
      }),
    );
    expect(cropCanvasToRect).not.toHaveBeenCalled();
  });

  it("still fails when the selected element cannot be resolved", async () => {
    await expect(
      runRenderPngBlob(renderArgs(elementInfo({ selector: "#missing" })), {
        scope: "element",
        settings: { scale: 1 },
      }),
    ).rejects.toBeInstanceOf(PngCaptureError);
  });

  it("propagates an unresolved crop from the native renderer", async () => {
    const node = document.createElement("div");
    node.id = "offscreen";
    node.getBoundingClientRect = () =>
      ({ left: 9000, top: 9000, width: 10, height: 10 }) as DOMRect;
    document.body.appendChild(node);
    vi.mocked(renderExportDocumentCanvas).mockRejectedValueOnce(
      new PngCaptureError("selection-unresolved"),
    );

    await expect(
      runRenderPngBlob(renderArgs(elementInfo({ selector: "#offscreen" })), {
        scope: "element",
        settings: { scale: 1 },
      }),
    ).rejects.toMatchObject({ code: "selection-unresolved" });
  });
});
