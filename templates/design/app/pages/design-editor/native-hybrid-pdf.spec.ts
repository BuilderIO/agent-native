// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderNativeHybridPdf } from "./native-hybrid-pdf";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(SVGElement.prototype, "getBBox");
});

describe("native hybrid vector PDF", () => {
  it("converts an actual SVG text and shape scene to a PDF container", async () => {
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 50, height: 20 }),
    });
    const blob = await renderNativeHybridPdf({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect x="0" y="0" width="100" height="60" fill="#eeeeee"/><text x="12" y="28" font-family="Helvetica" font-size="16">Vector</text></svg>',
      width: 100,
      height: 60,
      signal: new AbortController().signal,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(blob.type).toBe("application/pdf");
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe("%PDF-");
    expect(blob.size).toBeGreaterThan(100);
    expect(new TextDecoder("latin1").decode(bytes)).toContain("BT");
  });

  it("keeps an authored sans header bold and tracked instead of silently using Times", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: () => ({ width: 80 }),
    } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 80, height: 20 }),
    });
    const blob = await renderNativeHybridPdf({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="12" y="28" font-family="Helvetica, sans-serif" font-size="12" font-weight="600" letter-spacing="1.68"><tspan x="12" y="28">01 · GRAIN FILL</tspan></text></svg>',
      width: 200,
      height: 60,
      signal: new AbortController().signal,
    });
    const pdf = new TextDecoder("latin1").decode(await blob.arrayBuffer());
    const text = pdf.slice(pdf.indexOf("(01 · GRAIN FILL) Tj") - 180);
    expect(text).toMatch(/\/F2 12 Tf/);
    expect(Number(text.match(/([\d.]+) Tc/)?.[1])).toBeCloseTo(1.68, 5);
  });

  it("refuses an unavailable custom PDF font without a declared standard fallback", async () => {
    await expect(
      renderNativeHybridPdf({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><text x="12" y="28" font-family="PrivateFont" font-size="16">Vector</text></svg>',
        width: 100,
        height: 60,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/available standard fallback/);
  });

  it("rejects external image URLs before conversion", async () => {
    await expect(
      renderNativeHybridPdf({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><image href="https://example.com/image.png"/></svg>',
        width: 100,
        height: 60,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/not embedded locally/);
  });

  it("keeps vector text and embeds a native PNG crop in the same PDF", async () => {
    vi.stubGlobal(
      "Image",
      class {
        width = 1;
        height = 1;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 50, height: 20 }),
    });
    const crop =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    const blob = await renderNativeHybridPdf({
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><text x="12" y="28" font-family="Helvetica" font-size="16">Vector</text><image x="50" y="0" width="50" height="60" href="data:image/png;base64,${crop}"/></svg>`,
      width: 100,
      height: 60,
      signal: new AbortController().signal,
    });
    const pdf = new TextDecoder("latin1").decode(await blob.arrayBuffer());
    expect(pdf).toContain("BT");
    expect(pdf).toContain("/Subtype /Image");
  });

  it("converts only an embedded static SVG image to PNG while keeping sibling PDF text vector", async () => {
    const crop =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 1;
        naturalHeight = 1;
        width = 1;
        height = 1;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
          if (value) queueMicrotask(() => this.onload?.());
        }
      },
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      measureText: () => ({ width: 32 }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) =>
        callback(
          new Blob(
            [Uint8Array.from(atob(crop), (char) => char.charCodeAt(0))],
            {
              type: "image/png",
            },
          ),
        ),
    );
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 50, height: 20 }),
    });
    const ownedImage = btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#f00"/></svg>',
    );
    const blob = await renderNativeHybridPdf({
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><text x="12" y="28" font-family="Helvetica" font-size="16">Vector</text><image x="50" y="0" width="50" height="60" href="data:image/svg+xml;base64,${ownedImage}"/></svg>`,
      width: 100,
      height: 60,
      signal: new AbortController().signal,
    });
    const pdf = new TextDecoder("latin1").decode(await blob.arrayBuffer());
    expect(pdf).toContain("BT");
    expect(pdf).toContain("/Subtype /Image");
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it("rejects active content inside an embedded SVG image", async () => {
    const unsafe = btoa("<svg><script>danger()</script></svg>");
    await expect(
      renderNativeHybridPdf({
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><image href="data:image/svg+xml;base64,${unsafe}"/></svg>`,
        width: 100,
        height: 60,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/not embedded locally/);
  });
});
