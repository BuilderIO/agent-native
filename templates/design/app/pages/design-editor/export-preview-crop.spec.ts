// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runRenderPngBlob } from "./commands/render-png-blob";
import { PngCaptureError, resolveExportCropTarget } from "./png-export-render";

vi.mock("html2canvas", () => ({ default: vi.fn() }));

function fakeCanvas(tag: string): HTMLCanvasElement {
  return {
    dataset: { tag },
    width: 1440,
    height: 900,
    toBlob: (callback: (blob: Blob | null) => void, type?: string) =>
      callback(new Blob([tag], { type: type ?? "image/png" })),
  } as unknown as HTMLCanvasElement;
}

const cropCanvasToRect = vi.fn<
  typeof import("./png-export-render").cropCanvasToRect
>(() => fakeCanvas("cropped"));

vi.mock("./png-export-render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./png-export-render")>();
  return {
    ...actual,
    renderExportDocumentCanvas: vi.fn(async () => ({
      canvas: fakeCanvas("full"),
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
  document.body.innerHTML = "";
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
  it("renders the whole screen when the screen root is selected", async () => {
    const blob = await runRenderPngBlob(
      renderArgs(elementInfo({ tagName: "BODY" })),
      { scope: "element", settings: { scale: 1 } },
    );

    expect(await blob.text()).toBe("full");
    expect(cropCanvasToRect).not.toHaveBeenCalled();
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

    expect(await blob.text()).toBe("full");
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

    expect(await documentBlob.text()).toBe("full");
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

    expect(await blob.text()).toBe("cropped");
    expect(cropCanvasToRect).toHaveBeenCalledTimes(1);
  });

  it("still fails when the selected element cannot be resolved", async () => {
    await expect(
      runRenderPngBlob(renderArgs(elementInfo({ selector: "#missing" })), {
        scope: "element",
        settings: { scale: 1 },
      }),
    ).rejects.toBeInstanceOf(PngCaptureError);
  });

  it("still fails when a resolvable selection crops to nothing", async () => {
    const node = document.createElement("div");
    node.id = "offscreen";
    node.getBoundingClientRect = () =>
      ({ left: 9000, top: 9000, width: 10, height: 10 }) as DOMRect;
    document.body.appendChild(node);
    cropCanvasToRect.mockReturnValueOnce(null);

    await expect(
      runRenderPngBlob(renderArgs(elementInfo({ selector: "#offscreen" })), {
        scope: "element",
        settings: { scale: 1 },
      }),
    ).rejects.toBeInstanceOf(PngCaptureError);
  });
});
