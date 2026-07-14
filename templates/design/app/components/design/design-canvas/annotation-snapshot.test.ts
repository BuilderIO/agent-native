import { afterEach, describe, expect, it, vi } from "vitest";

import type { DrawAnnotation } from "@/components/visual-editor";

const callAction = vi.fn();

vi.mock("@agent-native/core/client", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
}));

// Imported after the mock so the module under test picks up the mocked
// `callAction` binding.
const { captureAnnotatedScreenshot, drawAnnotationsOnContext } =
  await import("./annotation-snapshot");

function strokeAnnotation(
  overrides: Partial<DrawAnnotation> = {},
): DrawAnnotation {
  return {
    id: "s1",
    type: "path",
    pathData: "M10,10 L20,20",
    color: "#ef4444",
    lineWidth: 4,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function textAnnotation(
  overrides: Partial<DrawAnnotation> = {},
): DrawAnnotation {
  return {
    id: "t1",
    type: "text",
    text: "Move this button",
    color: "#3b82f6",
    lineWidth: 4,
    position: { x: 40, y: 60 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// drawAnnotationsOnContext — pure rasterization, no real canvas needed since
// it only depends on a handful of CanvasRenderingContext2D methods/setters.
// ---------------------------------------------------------------------------

describe("drawAnnotationsOnContext", () => {
  function fakeCtx() {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      font: "",
      textBaseline: "",
    };
  }

  it("strokes a path annotation with its color and width", () => {
    const ctx = fakeCtx();
    drawAnnotationsOnContext(ctx as never, [strokeAnnotation()]);
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
    expect(ctx.lineTo).toHaveBeenCalledWith(20, 20);
    expect(ctx.stroke).toHaveBeenCalledOnce();
    expect(ctx.strokeStyle).toBe("#ef4444");
    expect(ctx.lineWidth).toBe(4);
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it("draws a text annotation at its serialized position", () => {
    const ctx = fakeCtx();
    drawAnnotationsOnContext(ctx as never, [textAnnotation()]);
    expect(ctx.fillText).toHaveBeenCalledWith("Move this button", 40, 60);
    expect(ctx.fillStyle).toBe("#3b82f6");
  });

  it("draws multiple annotations in order and skips empty ones", () => {
    const ctx = fakeCtx();
    drawAnnotationsOnContext(ctx as never, [
      strokeAnnotation({ id: "s1" }),
      { ...textAnnotation({ id: "t-empty" }), text: "" },
      textAnnotation({ id: "t2", text: "Label" }),
    ]);
    expect(ctx.stroke).toHaveBeenCalledOnce();
    expect(ctx.fillText).toHaveBeenCalledOnce();
    expect(ctx.fillText).toHaveBeenCalledWith("Label", 40, 60);
  });
});

// ---------------------------------------------------------------------------
// captureAnnotatedScreenshot — orchestration + graceful-degradation contract
// ---------------------------------------------------------------------------

describe("captureAnnotatedScreenshot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    callAction.mockReset();
  });

  const baseOptions = {
    designId: "design-1",
    fileId: "file-1",
    annotations: [strokeAnnotation()],
    canvasSize: { width: 1024, height: 768 },
  };

  it("returns null for localhost/fusion screens without calling take-design-screenshot", async () => {
    const result = await captureAnnotatedScreenshot({
      ...baseOptions,
      sourceType: "localhost",
    });
    expect(result).toBeNull();
    expect(callAction).not.toHaveBeenCalled();
  });

  it("returns null when neither designId nor fileId is available", async () => {
    const result = await captureAnnotatedScreenshot({
      ...baseOptions,
      designId: undefined,
      fileId: undefined,
    });
    expect(result).toBeNull();
    expect(callAction).not.toHaveBeenCalled();
  });

  it("returns null when the canvas size is too small to be a real screen", async () => {
    const result = await captureAnnotatedScreenshot({
      ...baseOptions,
      canvasSize: { width: 10, height: 10 },
    });
    expect(result).toBeNull();
    expect(callAction).not.toHaveBeenCalled();
  });

  it("returns null when document is unavailable (SSR-like environment)", async () => {
    vi.stubGlobal("document", undefined);
    const result = await captureAnnotatedScreenshot(baseOptions);
    expect(result).toBeNull();
  });

  it("falls back to null when take-design-screenshot reports no Chromium available", async () => {
    vi.stubGlobal("document", { createElement: vi.fn() });
    callAction.mockResolvedValueOnce({
      ok: false,
      reason: "no chromium available",
    });
    const result = await captureAnnotatedScreenshot(baseOptions);
    expect(result).toBeNull();
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction).toHaveBeenCalledWith(
      "take-design-screenshot",
      expect.objectContaining({
        fileId: "file-1",
        widths: [1024],
        heights: [768],
      }),
    );
  });

  it("falls back to null when the screenshot fetch fails", async () => {
    vi.stubGlobal("document", { createElement: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    callAction.mockResolvedValueOnce({
      ok: true,
      screenshots: [{ url: "https://cdn.example.com/shot.png" }],
    });
    const result = await captureAnnotatedScreenshot(baseOptions);
    expect(result).toBeNull();
    // Never reaches the upload-image call once compositing fails.
    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it("composites the screenshot with annotations and uploads the result", async () => {
    const fakeCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      drawImage: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      font: "",
      textBaseline: "",
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(fakeCtx),
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,composited"),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(fakeCanvas),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue({}),
      }),
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        // Resolve asynchronously like a real Image decode.
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);

    callAction.mockImplementation((name: string) => {
      if (name === "take-design-screenshot") {
        return Promise.resolve({
          ok: true,
          screenshots: [{ url: "https://cdn.example.com/shot.png" }],
        });
      }
      if (name === "upload-image") {
        return Promise.resolve({
          url: "https://cdn.example.com/annotated-shot.png",
        });
      }
      throw new Error(`unexpected action ${name}`);
    });

    const result = await captureAnnotatedScreenshot(baseOptions);

    expect(result).toBe("https://cdn.example.com/annotated-shot.png");
    expect(fakeCtx.drawImage).toHaveBeenCalledOnce();
    expect(fakeCtx.stroke).toHaveBeenCalledOnce();
    expect(callAction).toHaveBeenCalledWith(
      "upload-image",
      expect.objectContaining({ data: "data:image/png;base64,composited" }),
    );
  });
});
