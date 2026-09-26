
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

export interface PdfParseSetup {
  PDFParse: typeof import("pdf-parse").PDFParse;
  canvasFactory: object | undefined;
}

export async function setupPdfParse(): Promise<PdfParseSetup> {
  installDomMatrixPolyfillIfMissing();

  const { PDFParse } = await import("pdf-parse");
  let canvasFactory: object | undefined;
  try {
    const { CanvasFactory, getData } = await import("pdf-parse/worker");
    PDFParse.setWorker(getData());
    canvasFactory = CanvasFactory;
  } catch (err) {
    console.warn(
      "[import-file] pdf-parse canvas worker setup failed, continuing without it (text-only extraction is unaffected):",
      err instanceof Error ? err.message : String(err),
    );
  }
  return { PDFParse, canvasFactory };
}
