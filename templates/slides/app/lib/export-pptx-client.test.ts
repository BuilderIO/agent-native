// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const addImage = vi.fn();
  const addNotes = vi.fn();
  const slideInstance = { addImage, addNotes, background: undefined };
  const addSlide = vi.fn(() => slideInstance);
  const defineLayout = vi.fn();
  const write = vi.fn();
  const pptxInstance = {
    addSlide,
    author: "",
    defineLayout,
    layout: "",
    title: "",
    write,
  };

  return {
    addImage,
    addNotes,
    addSlide,
    defineLayout,
    domToJpeg: vi.fn(),
    pptxInstance,
    PptxGenJS: vi.fn(function PptxGenJS() {
      return pptxInstance;
    }),
    slideInstance,
    write,
  };
});

vi.mock("modern-screenshot", () => ({
  domToJpeg: mocks.domToJpeg,
}));

vi.mock("pptxgenjs", () => ({
  default: mocks.PptxGenJS,
}));

import { exportDeckAsPptx } from "./export-pptx-client";

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML =
    '<div data-slide-canvas="slide-1" style="width: 960px; height: 540px;"></div>';
  const slideCanvas = document.querySelector<HTMLElement>(
    '[data-slide-canvas="slide-1"]',
  );
  Object.defineProperty(slideCanvas, "offsetWidth", {
    configurable: true,
    value: 960,
  });
  const cssShim = (globalThis.CSS ??
    ({} as unknown as typeof CSS)) as typeof CSS & {
    escape: (s: string) => string;
  };
  Object.defineProperty(cssShim, "escape", {
    configurable: true,
    value: (s: string) => s,
  });
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: cssShim,
  });
  mocks.pptxInstance.author = "";
  mocks.pptxInstance.layout = "";
  mocks.pptxInstance.title = "";
  mocks.slideInstance.background = undefined;
  mocks.write.mockResolvedValue(new Blob(["pptx"]));
  mocks.domToJpeg.mockResolvedValue("data:image/jpeg;base64,abc123");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pptx");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
  const realSetTimeout = window.setTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ) => {
    if (timeout === 60_000) return 1;
    return realSetTimeout(handler, timeout, ...args);
  }) as typeof window.setTimeout);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportDeckAsPptx", () => {
  it("captures rendered slides as full-bleed PPTX images", async () => {
    await exportDeckAsPptx(
      "Quarterly Review",
      [{ id: "slide-1", notes: "Speaker notes" }],
      "16:9",
    );

    const slideCanvas = document.querySelector('[data-slide-canvas="slide-1"]');
    expect(mocks.domToJpeg).toHaveBeenCalledWith(
      slideCanvas,
      expect.objectContaining({
        backgroundColor: "#000000",
        height: 540,
        quality: 0.92,
        scale: 2,
        width: 960,
      }),
    );
    expect(mocks.addImage).toHaveBeenCalledWith({
      data: "image/jpeg;base64,abc123",
      h: 7.5,
      w: 13.33,
      x: 0,
      y: 0,
    });
    expect(mocks.addNotes).toHaveBeenCalledWith("Speaker notes");
    expect(mocks.pptxInstance.layout).toBe("LAYOUT_WIDE");
    expect(mocks.pptxInstance.title).toBe("Quarterly Review");
    expect(mocks.write).toHaveBeenCalledWith({
      compression: true,
      outputType: "blob",
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });
});
