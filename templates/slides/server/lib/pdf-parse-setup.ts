/**
 * Prod incident (2026-07-25 reliability sweep): `import-file`'s PDF path
 * crashed with "DOMMatrix is not defined" 21 times in 14 days. `pdf-parse`'s
 * `/worker` submodule unconditionally imports `@napi-rs/canvas` (a native
 * N-API binary) as a side effect of the import itself — just to read its
 * bundled worker-script blob (`getData()`) — and assigns its `DOMMatrix`
 * export onto `globalThis` for pdfjs-dist's text-transform math to use. That
 * native binary is fragile in serverless Lambda-style environments (missing
 * platform binding, wrong glibc/musl target) and can silently fail to
 * populate `globalThis.DOMMatrix` without the surrounding import itself
 * throwing, so the crash only surfaces later, deep inside `getText()`.
 *
 * `getText()` never renders to a canvas — `CanvasFactory` is documented
 * optional on `LoadParameters` and is only consumed by `getImage()`/
 * `getScreenshot()`. So for pure text extraction we don't need the canvas
 * import to succeed; we only need SOME `DOMMatrix` implementation to exist
 * for pdfjs-dist's 2D transform math. This installs a minimal, spec-correct
 * 2D-affine `DOMMatrix` polyfill (PDF content-stream matrices are always the
 * 2D 6-value form, never 3D) as a fallback, then attempts the real
 * `@napi-rs/canvas`-backed setup for the CanvasFactory/worker-script wiring,
 * catching failure instead of letting it crash the whole import.
 */

interface Minimal2DMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  is2D: boolean;
  isIdentity: boolean;
  multiply(other: Minimal2DMatrix): Minimal2DMatrix;
  translate(tx?: number, ty?: number): Minimal2DMatrix;
  scale(sx?: number, sy?: number): Minimal2DMatrix;
  inverse(): Minimal2DMatrix;
  toString(): string;
}

function installDomMatrixPolyfillIfMissing(): void {
  if (
    typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix !== "undefined"
  ) {
    return;
  }

  class PolyfillDOMMatrix implements Minimal2DMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(init?: number[] | string) {
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }

    get is2D(): boolean {
      return true;
    }

    get isIdentity(): boolean {
      return (
        this.a === 1 &&
        this.b === 0 &&
        this.c === 0 &&
        this.d === 1 &&
        this.e === 0 &&
        this.f === 0
      );
    }

    multiply(other: Minimal2DMatrix): PolyfillDOMMatrix {
      return new PolyfillDOMMatrix([
        this.a * other.a + this.c * other.b,
        this.b * other.a + this.d * other.b,
        this.a * other.c + this.c * other.d,
        this.b * other.c + this.d * other.d,
        this.a * other.e + this.c * other.f + this.e,
        this.b * other.e + this.d * other.f + this.f,
      ]);
    }

    translate(tx = 0, ty = 0): PolyfillDOMMatrix {
      return this.multiply(new PolyfillDOMMatrix([1, 0, 0, 1, tx, ty]));
    }

    scale(sx = 1, sy = sx): PolyfillDOMMatrix {
      return this.multiply(new PolyfillDOMMatrix([sx, 0, 0, sy, 0, 0]));
    }

    inverse(): PolyfillDOMMatrix {
      const det = this.a * this.d - this.b * this.c;
      if (det === 0) return new PolyfillDOMMatrix();
      const invDet = 1 / det;
      return new PolyfillDOMMatrix([
        this.d * invDet,
        -this.b * invDet,
        -this.c * invDet,
        this.a * invDet,
        (this.c * this.f - this.d * this.e) * invDet,
        (this.b * this.e - this.a * this.f) * invDet,
      ]);
    }

    toString(): string {
      return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
    }
  }

  (globalThis as { DOMMatrix?: unknown }).DOMMatrix = PolyfillDOMMatrix;
}

/** Result of `setupPdfParse` — pass `canvasFactory` to `new PDFParse(...)` when present. */
export interface PdfParseSetup {
  PDFParse: typeof import("pdf-parse").PDFParse;
  canvasFactory: object | undefined;
}

/**
 * Sets up `pdf-parse` for text extraction, tolerating a broken native-canvas
 * dependency. Always installs the DOMMatrix polyfill FIRST (cheap, no
 * native deps, spec-correct for the 2D case pdfjs-dist actually uses) so
 * `getText()` can never hit "DOMMatrix is not defined" regardless of
 * whether the canvas worker setup below succeeds.
 */
export async function setupPdfParse(): Promise<PdfParseSetup> {
  installDomMatrixPolyfillIfMissing();

  const { PDFParse } = await import("pdf-parse");
  let canvasFactory: object | undefined;
  try {
    const { CanvasFactory, getData } = await import("pdf-parse/worker");
    PDFParse.setWorker(getData());
    canvasFactory = CanvasFactory;
  } catch (err) {
    // Native @napi-rs/canvas binding unavailable in this runtime — fine for
    // text-only extraction. Leave the worker script unconfigured (a
    // documented no-op read, see PDFParse.setWorker) and CanvasFactory
    // undefined; pdfjs-dist runs in-process without a separate worker.
    console.warn(
      "[import-file] pdf-parse canvas worker setup failed, continuing without it (text-only extraction is unaffected):",
      err instanceof Error ? err.message : String(err),
    );
  }
  return { PDFParse, canvasFactory };
}
