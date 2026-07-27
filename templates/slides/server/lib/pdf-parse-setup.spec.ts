import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("setupPdfParse", () => {
  const originalDOMMatrix = (globalThis as { DOMMatrix?: unknown }).DOMMatrix;

  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as { DOMMatrix?: unknown }).DOMMatrix;
  });

  afterEach(() => {
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = originalDOMMatrix;
    vi.doUnmock("pdf-parse/worker");
  });

  it("installs a spec-correct 2D DOMMatrix polyfill when none exists", async () => {
    const { setupPdfParse } = await import("./pdf-parse-setup.js");
    await setupPdfParse().catch(() => {});

    const DOMMatrixCtor = (globalThis as { DOMMatrix?: any }).DOMMatrix;
    expect(DOMMatrixCtor).toBeDefined();

    // translate(10, 20) followed by scale(2, 3) must compose like the real
    // DOMMatrix 2D affine API (verified against known matrix arithmetic).
    const m = new DOMMatrixCtor().translate(10, 20).scale(2, 3);
    expect(m.a).toBe(2);
    expect(m.d).toBe(3);
    expect(m.e).toBe(10);
    expect(m.f).toBe(20);

    // inverse() must actually invert: m * m^-1 === identity.
    const identity = m.multiply(m.inverse());
    expect(identity.a).toBeCloseTo(1);
    expect(identity.b).toBeCloseTo(0);
    expect(identity.c).toBeCloseTo(0);
    expect(identity.d).toBeCloseTo(1);
    expect(identity.e).toBeCloseTo(0);
    expect(identity.f).toBeCloseTo(0);
  });

  it("does not overwrite an already-present DOMMatrix", async () => {
    class RealDOMMatrix {
      marker = "real";
    }
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = RealDOMMatrix;

    const { setupPdfParse } = await import("./pdf-parse-setup.js");
    await setupPdfParse().catch(() => {});

    expect((globalThis as { DOMMatrix?: unknown }).DOMMatrix).toBe(
      RealDOMMatrix,
    );
  });

  it("falls back to no CanvasFactory instead of throwing when the native canvas worker import fails", async () => {
    vi.doMock("pdf-parse/worker", () => {
      throw new Error("Failed to load native binding for this platform");
    });

    const { setupPdfParse } = await import("./pdf-parse-setup.js");
    const result = await setupPdfParse();

    expect(result.canvasFactory).toBeUndefined();
    expect(result.PDFParse).toBeDefined();
    // The DOMMatrix polyfill must still be installed even though the canvas
    // worker setup failed — this is the actual fix for the prod crash.
    expect((globalThis as { DOMMatrix?: unknown }).DOMMatrix).toBeDefined();
  });
});
