// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { nativeCaptureRoi } from "./native-capture-roi";
import {
  CachedLeaf,
  createNativeSceneProvider,
} from "./native-source-provider";
import { nativeSvgPatternFixtures } from "./native-svg-pattern-fixtures";
import {
  NativeSvgSourceError,
  rasterNativeSvgSource,
  serializeNativeSvgSource as serializeSource,
} from "./native-svg-source";

const NS = "http://www.w3.org/2000/svg";
const svg = (markup: string): SVGSVGElement => {
  const source = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = document.importNode(source.documentElement, true);
  if (!(root instanceof SVGSVGElement)) throw new Error("SVG fixture failed");
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.localName === "pattern") {
      for (const name of ["width", "height"])
        Object.defineProperty(element, name, {
          configurable: true,
          get: () => ({
            baseVal: {
              value: Math.fround(
                Number.parseFloat(element.getAttribute(name)!),
              ),
            },
          }),
        });
    }
    Object.defineProperty(element, "getScreenCTM", {
      configurable: true,
      value: () => {
        const specified = element.getAttribute("data-test-screen-matrix");
        if (specified === "unreadable") return null;
        if (specified === "throws") throw new Error("matrix fixture failure");
        const matrix = (values: number[], is2D = true) => ({
          a: values[0],
          b: values[1],
          c: values[2],
          d: values[3],
          e: values[4],
          f: values[5],
          is2D,
        });
        if (specified === "not2d") return matrix([1, 0, 0, 1, 0, 0], false);
        if (specified) return matrix(JSON.parse(specified));
        const viewBox = root
          .getAttribute("viewBox")
          ?.trim()
          .split(/[\s,]+/)
          .map(Number);
        const viewport = root.getBoundingClientRect();
        if (!viewBox) return matrix([1, 0, 0, 1, 0, 0]);
        const scale = Math.min(
          viewport.width / viewBox[2],
          viewport.height / viewBox[3],
        );
        return matrix([scale, 0, 0, scale, 0, 0]);
      },
    });
  }
  document.body.append(root);
  return root;
};

const serializeNativeSvgSource = (
  root: SVGSVGElement,
  size: { width: number; height: number },
): string => {
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, size.width, size.height),
  );
  return serializeSource(root, size);
};

const captureCode = (run: () => void): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    if (!(error instanceof NativeSvgSourceError)) throw error;
    return error.code;
  }
};

const mockStyles = (): void => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      ({
        overflow: element.getAttribute("data-test-overflow") ?? "hidden",
        overflowX: element.getAttribute("data-test-overflow") ?? "hidden",
        overflowY: element.getAttribute("data-test-overflow") ?? "hidden",
        paddingTop: element.getAttribute("data-test-padding") ?? "0px",
        paddingRight: element.getAttribute("data-test-padding") ?? "0px",
        paddingBottom: element.getAttribute("data-test-padding") ?? "0px",
        paddingLeft: element.getAttribute("data-test-padding") ?? "0px",
        filter: "none",
        mask: element.getAttribute("data-test-mask") ?? "none",
        maskImage: element.getAttribute("data-test-mask-image") ?? "none",
        mixBlendMode: "normal",
        borderTopLeftRadius: element.getAttribute("data-test-radius") ?? "0px",
        borderTopRightRadius: element.getAttribute("data-test-radius") ?? "0px",
        borderBottomRightRadius:
          element.getAttribute("data-test-radius") ?? "0px",
        borderBottomLeftRadius:
          element.getAttribute("data-test-radius") ?? "0px",
        getPropertyValue: (name: string) =>
          name === "overflow-clip-margin"
            ? (element.getAttribute("data-test-overflow-margin") ?? "0px")
            : name === "d"
              ? (element.getAttribute("data-test-computed-d") ?? "")
              : "",
        x:
          element.getAttribute("data-test-computed-x") ??
          element.getAttribute("x") ??
          "0px",
        y:
          element.getAttribute("data-test-computed-y") ??
          element.getAttribute("y") ??
          "0px",
        width:
          element.getAttribute("data-test-computed-width") ??
          element.getAttribute("width") ??
          "auto",
        height:
          element.getAttribute("data-test-computed-height") ??
          element.getAttribute("height") ??
          "auto",
        cx:
          element.getAttribute("data-test-computed-cx") ??
          element.getAttribute("cx") ??
          "0px",
        cy:
          element.getAttribute("data-test-computed-cy") ??
          element.getAttribute("cy") ??
          "0px",
        r:
          element.getAttribute("data-test-computed-r") ??
          element.getAttribute("r") ??
          "0px",
        rx:
          element.getAttribute("data-test-computed-rx") ??
          element.getAttribute("rx") ??
          "auto",
        ry:
          element.getAttribute("data-test-computed-ry") ??
          element.getAttribute("ry") ??
          "auto",
        transform:
          element.getAttribute("data-test-computed-transform") ?? "none",
        backdropFilter: "none",
        rotate: "none",
        scale: "none",
        perspective: "none",
        transformStyle: "flat",
        zoom: element.getAttribute("data-test-zoom") ?? "1",
        fill: element.getAttribute("fill") ?? "black",
        stroke: element.getAttribute("stroke") ?? "none",
        stopColor: element.getAttribute("stop-color") ?? "black",
        fontFamily: element.getAttribute("font-family") ?? "sans-serif",
        fontSize: "16px",
        fontStretch: element.getAttribute("data-test-font-stretch") ?? "normal",
        fontVariant: element.getAttribute("data-test-font-variant") ?? "normal",
        fontVariantCaps:
          element.getAttribute("data-test-font-variant-caps") ?? "normal",
        fontVariantLigatures: "normal",
        fontVariantNumeric: "normal",
        fontVariantEastAsian: "normal",
        fontFeatureSettings:
          element.getAttribute("data-test-font-feature-settings") ?? "normal",
        fontVariationSettings:
          element.getAttribute("data-test-font-variation-settings") ?? "normal",
        textDecorationLine:
          element.getAttribute("data-test-text-decoration-line") ?? "none",
        textTransform: "none",
        textShadow: "none",
        colorInterpolation:
          element.getAttribute("data-test-color-interpolation") ??
          element.getAttribute("color-interpolation") ??
          "sRGB",
        opacity: element.getAttribute("opacity") ?? "1",
        clipPath: element.getAttribute("clip-path") ?? "none",
      }) as unknown as CSSStyleDeclaration,
  );
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native SVG source raster boundary", () => {
  it("serializes bounded vector geometry, local gradients, computed color, text, and alpha", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}" viewBox="0 0 80 50"><defs><linearGradient id="ink"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="crop"><circle cx="20" cy="20" r="15"/></clipPath></defs><g clip-path="url(#crop)"><rect x="4" y="6" width="60" height="30" fill="url(#ink)" opacity="0.5"/></g><text x="7" y="20" font-family="sans-serif">SVG</text></svg>`,
    );
    const result = serializeNativeSvgSource(root, { width: 80, height: 50 });
    expect(result).toContain('viewBox="0 0 80 50"');
    expect(result).toContain('fill="url(#ink)"');
    expect(result).toContain('clip-path="url(#crop)"');
    expect(result).toContain('opacity="0.5"');
    expect(result).toContain("SVG</text>");
    expect(result).toContain('color-interpolation="sRGB"');
    expect(result).not.toContain("foreignObject");
  });

  it.each(nativeSvgPatternFixtures)(
    "serializes retained S/T pattern fixture $name without changing its tile geometry",
    ({ markup, patterns }) => {
      mockStyles();
      const root = svg(markup);
      const serialized = serializeNativeSvgSource(root, {
        width: 240,
        height: 160,
      });
      const clone = new DOMParser().parseFromString(
        serialized,
        "image/svg+xml",
      ).documentElement;
      expect(clone.querySelectorAll("pattern")).toHaveLength(patterns);
      const originals = [...root.querySelectorAll("pattern")];
      const captures = [...clone.querySelectorAll("pattern")];
      for (let index = 0; index < originals.length; index += 1) {
        for (const attribute of ["id", "width", "height", "patternUnits"])
          expect(captures[index].getAttribute(attribute)).toBe(
            originals[index].getAttribute(attribute),
          );
        expect(captures[index].children).toHaveLength(
          originals[index].children.length,
        );
        expect(captures[index].getAttribute("overflow")).toBe("hidden");
      }
    },
  );

  it("retains fractional tile geometry and child paint alpha without copying stylesheet geometry onto the pattern", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}" viewBox="0 0 12 8"><defs><pattern id="checks" class="theme" style="width:500px" width="1" height="1" patternUnits="userSpaceOnUse" data-test-computed-width="500px"><rect width="1" height="1" fill="red"/><rect x="0.5" width="0.5" height="0.5" fill="blue" opacity="0.5"/></pattern></defs><rect width="12" height="8" fill="url(#checks)"/></svg>`,
    );
    const serialized = serializeNativeSvgSource(root, { width: 12, height: 8 });
    const capture = new DOMParser().parseFromString(
      serialized,
      "image/svg+xml",
    );
    const pattern = capture.querySelector("pattern")!;
    expect(pattern.getAttribute("width")).toBe("1");
    expect(pattern.getAttribute("height")).toBe("1");
    expect(pattern.getAttribute("overflow")).toBe("hidden");
    expect(pattern.hasAttribute("class")).toBe(false);
    expect(pattern.hasAttribute("style")).toBe(false);
    expect(pattern.children[1].getAttribute("x")).toBe("0.5");
    expect(pattern.children[1].getAttribute("width")).toBe("0.5");
    expect(pattern.children[1].getAttribute("opacity")).toBe("0.5");
    expect(capture.documentElement.lastElementChild?.getAttribute("fill")).toBe(
      "url(#checks)",
    );
  });

  it("serializes fresh computed pattern child paint after a class change", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><pattern id="ink" width="8" height="6" patternUnits="userSpaceOnUse"><rect class="first" width="4" height="6" fill="red"/></pattern></defs><rect width="24" height="12" fill="url(#ink)"/></svg>`,
    );
    const child = root.querySelector("pattern rect")!;
    const styles = vi.mocked(window.getComputedStyle).getMockImplementation()!;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = styles(element);
      return element === child
        ? ({
            ...style,
            fill:
              child.getAttribute("class") === "first"
                ? "rgb(255, 0, 0)"
                : "rgb(0, 128, 0)",
          } as CSSStyleDeclaration)
        : style;
    });
    const before = serializeNativeSvgSource(root, { width: 24, height: 12 });
    child.setAttribute("class", "second");
    const after = serializeNativeSvgSource(root, { width: 24, height: 12 });
    expect(before).toContain('fill="rgb(255, 0, 0)"');
    expect(after).toContain('fill="rgb(0, 128, 0)"');
    expect(after).not.toContain('class="second"');
  });

  it("preserves signed tile origin and a bounded viewBox rather than pre-rasterizing a custom tile", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><pattern id="offset" x="-2.5" y="+3" width="1e1" height="6px" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" viewBox="-4 -2 8 4" preserveAspectRatio="xMinYMin meet"><rect x="-4" y="-2" width="4" height="4" fill="red"/></pattern></defs><rect width="30" height="18" fill="url(#offset)"/></svg>`,
    );
    const serialized = serializeNativeSvgSource(root, {
      width: 30,
      height: 18,
    });
    const pattern = new DOMParser()
      .parseFromString(serialized, "image/svg+xml")
      .querySelector("pattern")!;
    expect(pattern.getAttribute("x")).toBe("-2.5");
    expect(pattern.getAttribute("y")).toBe("+3");
    expect(pattern.getAttribute("width")).toBe("1e1");
    expect(pattern.getAttribute("height")).toBe("6px");
    expect(pattern.getAttribute("viewBox")).toBe("-4 -2 8 4");
    expect(pattern.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
  });

  it("allows an acyclic pattern to use a local gradient and a local vector clip", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><linearGradient id="wash"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="cut"><circle cx="4" cy="4" r="3"/></clipPath><pattern id="tile" width="8" height="8" patternUnits="userSpaceOnUse"><g clip-path="url(#cut)"><rect width="8" height="8" fill="url(#wash)"/></g></pattern></defs><rect width="32" height="16" fill="url(#tile)"/></svg>`,
    );
    const serialized = serializeNativeSvgSource(root, {
      width: 32,
      height: 16,
    });
    expect(serialized).toContain('fill="url(#wash)"');
    expect(serialized).toContain('clip-path="url(#cut)"');
    expect(serialized).toContain('fill="url(#tile)"');
  });

  it("refuses nested pattern expansion until its reference context can be bounded", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><pattern id="small" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="2" fill="red"/></pattern><pattern id="large" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="4" fill="url(#small)"/></pattern></defs><rect width="24" height="16" fill="url(#large)"/></svg>`,
    );
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 24, height: 16 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
  });

  it.each(["1e-300", "1e-320", "0.000001"])(
    "rejects excessive tile repetition before intrinsic decode (%s)",
    async (tileWidth) => {
      mockStyles();
      const source = svg(
        `<svg xmlns="${NS}" viewBox="0 0 240 160"><defs><pattern id="tiny" width="${tileWidth}" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="red"/></pattern></defs><rect width="240" height="160" fill="url(#tiny)"/></svg>`,
      );
      vi.spyOn(source, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 240, 160),
      );
      const construct = vi.fn();
      vi.stubGlobal(
        "Image",
        class {
          constructor() {
            construct();
          }
        },
      );
      await expect(
        rasterNativeSvgSource(source, document.createElement("canvas"), 2),
      ).rejects.toMatchObject({ code: "source-svg-pattern-work-limit" });
      expect(construct).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2])(
    "retains half-unit tile capture and original checker geometry at density %s",
    async (density) => {
      mockStyles();
      const source = svg(
        `<svg xmlns="${NS}" viewBox="0 0 240 160"><defs><pattern id="fractional" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><rect width="0.25" height="0.5" fill="red"/></pattern></defs><rect width="240" height="160" fill="url(#fractional)"/></svg>`,
      );
      vi.spyOn(source, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 240, 160),
      );
      const decoded: string[] = [];
      vi.stubGlobal(
        "Image",
        class {
          src = "";
          async decode() {
            decoded.push(
              decodeURIComponent(this.src.split(",").slice(1).join(",")),
            );
          }
        },
      );
      const canvas = document.createElement("canvas");
      vi.spyOn(canvas, "getContext").mockReturnValue({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      await rasterNativeSvgSource(source, canvas, density);
      expect(decoded).toHaveLength(1);
      expect(decoded[0]).toContain('width="0.5"');
      expect(decoded[0]).toContain('width="0.25"');
      expect(canvas.width).toBe(240 * density);
      expect(canvas.height).toBe(160 * density);
    },
  );

  it("sums repeated paint references and content cost within one capture", () => {
    mockStyles();
    const markup = (count: number) =>
      `<svg xmlns="${NS}"><defs><pattern id="tile" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="0.5" height="1"/></pattern></defs>${'<rect width="1024" height="1024" fill="url(#tile)"/>'.repeat(count)}</svg>`;
    const within = svg(markup(3));
    expect(() =>
      serializeNativeSvgSource(within, { width: 1024, height: 1024 }),
    ).not.toThrow();
    within.remove();
    const excessive = svg(markup(4));
    expect(
      captureCode(() =>
        serializeNativeSvgSource(excessive, { width: 1024, height: 1024 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
  });

  it("charges fill and stroke separately", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><pattern id="tile" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="0.5" height="1"/></pattern></defs><rect width="2000" height="1000" fill="url(#tile)" stroke="url(#tile)" stroke-width="1"/></svg>`,
    );
    expect(() =>
      serializeNativeSvgSource(root, { width: 2000, height: 1000 }),
    ).not.toThrow();
    root
      .querySelector("pattern")!
      .append(root.querySelector("pattern rect")!.cloneNode(true));
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 2000, height: 1000 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
  });

  it("rejects excessive root viewBox contraction and local affine contraction", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}" viewBox="0 0 240000 160000"><defs><pattern id="tile" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="0.5" height="1"/></pattern></defs><rect width="240000" height="160000" fill="url(#tile)"/></svg>`,
    );
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 240, height: 160 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
    root.setAttribute("viewBox", "0 0 240 160");
    root.lastElementChild!.setAttribute(
      "data-test-screen-matrix",
      "[0.001,0,0,0.001,0,0]",
    );
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 240, height: 160 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
  });

  it.each([
    "unreadable",
    "throws",
    "not2d",
    "[1,1,1,1,0,0]",
    "[1,1,1,1.0000000000000002,0,0]",
  ])("rejects an unavailable or unbounded local mapping (%s)", (matrix) => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><pattern id="tile" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="0.5" height="1"/></pattern></defs><rect width="240" height="160" fill="url(#tile)"/></svg>`,
    );
    root.lastElementChild!.setAttribute("data-test-screen-matrix", matrix);
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 240, height: 160 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
  });

  it("keeps a bounded reflected local mapping while refusing outer CSS transforms", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}" viewBox="0 0 240 160"><defs><pattern id="tile" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8"/></pattern></defs><rect width="240" height="160" fill="url(#tile)" data-test-screen-matrix="[-1,0,0,1,240,0]" data-test-computed-transform="matrix(-1,0,0,1,240,0)"/></svg>`,
    );
    expect(
      serializeNativeSvgSource(root, { width: 240, height: 160 }),
    ).toContain('transform="matrix(-1,0,0,1,240,0)"');
    document.body.setAttribute(
      "data-test-computed-transform",
      "matrix(2,0,0,1,0,0)",
    );
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 240, height: 160 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
    document.body.removeAttribute("data-test-computed-transform");
    document.body.setAttribute("data-test-zoom", "2");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 240, height: 160 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
    document.body.removeAttribute("data-test-zoom");
  });

  it("refuses unreadable or invalid native tile lengths without falling back to authored decimals", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><pattern id="tile" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8"/></pattern></defs><rect width="240" height="160" fill="url(#tile)"/></svg>`,
    );
    const pattern = root.querySelector("pattern")!;
    for (const value of [0, NaN, Infinity, -1]) {
      Object.defineProperty(pattern, "width", {
        configurable: true,
        get: () => ({ baseVal: { value } }),
      });
      expect(
        captureCode(() =>
          serializeNativeSvgSource(root, { width: 240, height: 160 }),
        ),
      ).toBe("source-svg-pattern-work-limit");
    }
    Object.defineProperty(pattern, "width", {
      configurable: true,
      get: () => {
        throw new Error("native tile fixture failure");
      },
    });
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 240, height: 160 }),
      ),
    ).toBe("source-svg-pattern-work-limit");
  });

  it("refuses a changed viewport rather than budgeting the source against different clone dimensions", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}" viewBox="0 0 240 160"><defs><pattern id="tile" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8"/></pattern></defs><rect width="240" height="160" fill="url(#tile)"/></svg>`,
    );
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 240, 160),
    );
    expect(
      captureCode(() => serializeSource(root, { width: 160, height: 240 })),
    ).toBe("source-svg-pattern-work-limit");
  });

  it.each([
    ['width="0" height="8" patternUnits="userSpaceOnUse"'],
    ['width="-1" height="8" patternUnits="userSpaceOnUse"'],
    ['width="1025" height="8" patternUnits="userSpaceOnUse"'],
    ['width="1024" height="1024" patternUnits="userSpaceOnUse"'],
    ['width="1e309" height="8" patternUnits="userSpaceOnUse"'],
    ['width="8%" height="8" patternUnits="userSpaceOnUse"'],
    ['x="5000" width="8" height="8" patternUnits="userSpaceOnUse"'],
    ['width="8" height="8"'],
    ['width="8" height="8" patternUnits="objectBoundingBox"'],
    [
      'width="8" height="8" patternUnits="userSpaceOnUse" patternContentUnits="objectBoundingBox"',
    ],
    [
      'width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(15)"',
    ],
    [
      'width="8" height="8" patternUnits="userSpaceOnUse" data-test-computed-transform="matrix(1,0,0,1,2,0)"',
    ],
    ['width="8" height="8" patternUnits="userSpaceOnUse" viewBox="0 0 0 8"'],
    [
      'width="8" height="8" patternUnits="userSpaceOnUse" data-test-overflow="visible"',
    ],
    ['width="8" height="8" patternUnits="userSpaceOnUse" href="#other"'],
    [
      'width="8" height="8" patternUnits="userSpaceOnUse" href="https://example.invalid/tile.svg#other"',
    ],
  ])(
    "rejects a pattern outside the supported local tile contract (%s)",
    (attributes) => {
      mockStyles();
      const root = svg(
        `<svg xmlns="${NS}"><defs><pattern id="tile" ${attributes}><rect width="8" height="8"/></pattern></defs><rect width="20" height="20" fill="url(#tile)"/></svg>`,
      );
      expect(
        captureCode(() =>
          serializeNativeSvgSource(root, { width: 20, height: 20 }),
        ),
      ).toBe("source-svg-pattern-unsupported");
    },
  );

  it("rejects direct and indirect pattern cycles before decode", () => {
    mockStyles();
    for (const definitions of [
      '<pattern id="a" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="url(#a)"/></pattern>',
      '<pattern id="a" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="url(#b)"/></pattern><pattern id="b" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="url(#a)"/></pattern>',
    ]) {
      const root = svg(
        `<svg xmlns="${NS}"><defs>${definitions}</defs><rect width="20" height="20" fill="url(#a)"/></svg>`,
      );
      expect(
        captureCode(() =>
          serializeNativeSvgSource(root, { width: 20, height: 20 }),
        ),
      ).toBe("source-svg-reference-cycle");
      root.remove();
    }
  });

  it("bounds pattern work against the expanded capture rather than the root viewport", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><pattern id="tile" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><rect width="0.5" height="0.5" fill="red"/></pattern></defs><rect width="20" height="20" fill="url(#tile)"/></svg>`,
    );
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 20, 20),
    );
    expect(
      captureCode(() => serializeSource(root, { width: 20, height: 20 })),
    ).toBeNull();
    expect(
      captureCode(() =>
        serializeSource(
          root,
          { width: 20, height: 20 },
          { width: 2820, height: 2820 },
        ),
      ),
    ).toBe("source-svg-pattern-work-limit");
  });

  it("rejects a paint lookup aimed at geometry and a clip lookup aimed at a paint server", () => {
    mockStyles();
    for (const drawing of [
      '<rect id="shape" width="8" height="8"/><rect width="20" height="20" fill="url(#shape)"/>',
      '<defs><pattern id="tile" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8"/></pattern></defs><rect width="20" height="20" clip-path="url(#tile)"/>',
    ]) {
      const root = svg(`<svg xmlns="${NS}">${drawing}</svg>`);
      expect(
        captureCode(() =>
          serializeNativeSvgSource(root, { width: 20, height: 20 }),
        ),
      ).toBe("source-svg-reference-kind-unsupported");
      root.remove();
    }
  });

  it("rejects external or unresolved pattern-child references and unsupported resource content", () => {
    mockStyles();
    for (const [content, expected] of [
      [
        '<rect width="8" height="8" fill="url(https://example.invalid/paint.svg#x)"/>',
        "source-svg-external-asset",
      ],
      [
        '<rect width="8" height="8" fill="url(#absent)"/>',
        "source-svg-reference-unresolved",
      ],
      [
        '<image href="https://example.invalid/image.png"/>',
        "source-svg-element-unsupported",
      ],
      [
        '<animate attributeName="width" values="1;2" dur="1s"/>',
        "source-svg-element-unsupported",
      ],
      [
        '<pattern id="nested" width="4" height="4" patternUnits="userSpaceOnUse"/>',
        "source-svg-pattern-unsupported",
      ],
      [
        '<rect width="8" height="8" onclick="alert(1)"/>',
        "source-svg-attribute-unsupported",
      ],
    ]) {
      const root = svg(
        `<svg xmlns="${NS}"><defs><pattern id="tile" width="8" height="8" patternUnits="userSpaceOnUse">${content}</pattern></defs><rect width="20" height="20" fill="url(#tile)"/></svg>`,
      );
      expect(
        captureCode(() =>
          serializeNativeSvgSource(root, { width: 20, height: 20 }),
        ),
      ).toBe(expected);
      root.remove();
    }
  });

  it.each([1, 1.6, 2])(
    "sends one canonical patterned SVG through the existing intrinsic decoder at density %s",
    async (density) => {
      mockStyles();
      const source = svg(
        `<svg xmlns="${NS}" viewBox="0 0 20 12"><defs><pattern id="tile" width="8" height="6" patternUnits="userSpaceOnUse"><rect width="4" height="3" fill="red"/><rect x="4" width="4" height="3" fill="blue" opacity="0.5"/></pattern></defs><rect width="20" height="12" fill="url(#tile)"/></svg>`,
      );
      vi.spyOn(source, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 20, 12),
      );
      const decoded: string[] = [];
      const images: Array<{ src: string }> = [];
      vi.stubGlobal(
        "Image",
        class {
          src = "";
          constructor() {
            images.push(this);
          }
          async decode() {
            decoded.push(
              decodeURIComponent(this.src.split(",").slice(1).join(",")),
            );
          }
        },
      );
      const canvas = document.createElement("canvas");
      const clear = vi.fn();
      const draw = vi.fn();
      vi.spyOn(canvas, "getContext").mockReturnValue({
        clearRect: clear,
        drawImage: draw,
      } as unknown as CanvasRenderingContext2D);
      await rasterNativeSvgSource(source, canvas, density);
      expect(decoded).toHaveLength(1);
      expect(decoded[0]).toContain('patternUnits="userSpaceOnUse"');
      expect(decoded[0]).toContain('opacity="0.5"');
      expect(canvas.width).toBe(Math.ceil(20 * density));
      expect(canvas.height).toBe(Math.ceil(12 * density));
      expect(clear).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
      expect(draw).toHaveBeenCalledWith(
        images[0],
        0,
        0,
        canvas.width,
        canvas.height,
      );
      expect(images[0].src).toBe("");
    },
  );

  it("rerasterizes a cached SVG after pattern content mutation and density change", async () => {
    mockStyles();
    const source = svg(
      `<svg xmlns="${NS}"><defs><pattern id="tile" width="8" height="6" patternUnits="userSpaceOnUse"><rect width="4" height="6" fill="red"/></pattern></defs><rect width="20" height="12" fill="url(#tile)"/></svg>`,
    );
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 20, 12),
    );
    Object.defineProperty(source, "getBBox", {
      value: () => new DOMRect(0, 0, 20, 12),
      configurable: true,
    });
    const decoded: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        async decode() {
          decoded.push(
            decodeURIComponent(this.src.split(",").slice(1).join(",")),
          );
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    let density = 1;
    const captures = vi.fn();
    const leaf = new CachedLeaf(
      source,
      captures,
      () => density,
      rasterNativeSvgSource,
    );
    try {
      await leaf.read();
      await leaf.read();
      expect(decoded).toHaveLength(1);
      source.querySelector("pattern rect")!.setAttribute("fill", "blue");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await leaf.read();
      expect(decoded).toHaveLength(2);
      expect(decoded[1]).toContain('fill="blue"');
      density = 2;
      const enlarged = await leaf.read();
      expect(decoded).toHaveLength(3);
      expect(enlarged.width).toBe(40);
      expect(enlarged.height).toBe(24);
      expect(captures).toHaveBeenCalledTimes(3);
    } finally {
      leaf.dispose();
    }
  });

  it("keeps a pattern decode failure typed and releases its image without drawing", async () => {
    mockStyles();
    const source = svg(
      `<svg xmlns="${NS}"><defs><pattern id="tile" width="8" height="6" patternUnits="userSpaceOnUse"><rect width="4" height="6"/></pattern></defs><rect width="20" height="12" fill="url(#tile)"/></svg>`,
    );
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 20, 12),
    );
    const images: Array<{ src: string }> = [];
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        constructor() {
          images.push(this);
        }
        async decode() {
          throw new Error("decode fixture failure");
        }
      },
    );
    const canvas = document.createElement("canvas");
    const draw = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    await expect(
      rasterNativeSvgSource(source, canvas, 1),
    ).rejects.toMatchObject({ code: "source-svg-raster-failed" });
    expect(draw).not.toHaveBeenCalled();
    expect(images[0].src).toBe("");
  });

  it("preserves text and tspan coordinate lists when computed CSS x/y have unrelated defaults", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><text x="37" y="49" data-test-computed-x="0px" data-test-computed-y="0px"><tspan x="20 42" y="36 48" data-test-computed-x="0px" data-test-computed-y="0px">Two</tspan></text></svg>`,
    );
    const result = serializeNativeSvgSource(root, { width: 160, height: 100 });
    expect(result).toMatch(/<text[^>]*\bx="37"[^>]*\by="49"/);
    expect(result).toMatch(/<tspan[^>]*\bx="20 42"[^>]*\by="36 48"/);
  });

  it("keeps gradient radius separate from CSS circle radius", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><radialGradient id="ink" r="45%" data-test-computed-r="0px"><stop offset="0" stop-color="red"/></radialGradient></defs><circle cx="25%" cy="50%" r="10%" data-test-computed-cx="25%" data-test-computed-cy="50%" data-test-computed-r="10%" fill="url(#ink)"/></svg>`,
    );
    const result = serializeNativeSvgSource(root, { width: 160, height: 100 });
    expect(result).toMatch(/<radialGradient[^>]*\br="45%"/);
    expect(result).toMatch(
      /<circle[^>]*\bcx="25%"[^>]*\bcy="50%"[^>]*\br="10%"/,
    );
  });

  it("uses CSS rect geometry while retaining nested SVG XML viewport dimensions", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><rect x="8" y="12" width="80" height="40" rx="auto" ry="12" data-test-computed-x="25%" data-test-computed-y="12px" data-test-computed-width="50%" data-test-computed-height="40px" data-test-computed-rx="auto" data-test-computed-ry="12px"/><svg x="12" y="8" width="64" height="40" data-test-computed-width="auto" data-test-computed-height="auto"><circle r="8"/></svg></svg>`,
    );
    const result = serializeNativeSvgSource(root, { width: 160, height: 100 });
    expect(result).toMatch(
      /<rect[^>]*\bx="25%"[^>]*\by="12px"[^>]*\bwidth="50%"[^>]*\bheight="40px"/,
    );
    expect(result).toMatch(/<rect[^>]*\brx="auto"[^>]*\bry="12px"/);
    expect([...result.matchAll(/<svg\b[^>]*>/g)][1]?.[0]).toContain(
      'width="64"',
    );
    expect([...result.matchAll(/<svg\b[^>]*>/g)][1]?.[0]).toContain(
      'height="40"',
    );
  });

  it("serializes a gradient CSS transform as gradientTransform", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><defs><linearGradient id="ink" gradientTransform="rotate(15)" data-test-computed-transform="matrix(1, 0, 0, 1, 12, 0)"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="80" height="40" fill="url(#ink)"/></svg>`,
    );
    const result = serializeNativeSvgSource(root, { width: 160, height: 100 });
    expect(result).toMatch(
      /<linearGradient[^>]*\bgradientTransform="matrix\(1, 0, 0, 1, 12, 0\)"/,
    );
    expect(result).not.toMatch(/<linearGradient[^>]*\stransform="matrix/);
  });

  it("serializes normalized computed path data and stylesheet shape overrides", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><path d="M14 3v4a1 1 0 0 0 1 1h4" data-test-computed-d='path("M 14 3 V 7 A 1 1 0 0 0 15 8 H 19")'/><path d="M0 0L10 10" data-test-computed-d='path("M 0 0 L 40 20")'/></svg>`,
    );
    const result = serializeNativeSvgSource(root, { width: 160, height: 100 });
    const paths = [...result.matchAll(/<path\b[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(paths[0]).toContain('d="M 14 3 V 7 A 1 1 0 0 0 15 8 H 19"');
    expect(paths[1]).toContain('d="M 0 0 L 40 20"');
  });

  it("removes computed path none and refuses unreadable or non-path CSS geometry", () => {
    mockStyles();
    const root = svg(
      `<svg xmlns="${NS}"><path d="M0 0L10 10" data-test-computed-d="none"/></svg>`,
    );
    expect(
      serializeNativeSvgSource(root, { width: 160, height: 100 }),
    ).not.toMatch(/<path[^>]*\bd=/);
    const path = root.querySelector("path")!;
    path.setAttribute(
      "data-test-computed-d",
      "url(https://example.invalid/path)",
    );
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 160, height: 100 }),
      ),
    ).toBe("source-svg-path-style-unsupported");
    path.removeAttribute("data-test-computed-d");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 160, height: 100 }),
      ),
    ).toBe("source-svg-path-style-unreadable");
  });

  it("refuses external image content, foreignObject HTML, unknown SVG elements, and event attributes", () => {
    mockStyles();
    for (const child of [
      `<image href="https://example.invalid/picture.png" width="10" height="10"/>`,
      `<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">Text</div></foreignObject>`,
      `<script>alert(1)</script>`,
      `<rect width="10" height="10" onclick="alert(1)"/>`,
    ]) {
      const root = svg(`<svg xmlns="${NS}">${child}</svg>`);
      expect(() =>
        serializeNativeSvgSource(root, { width: 20, height: 20 }),
      ).toThrow(NativeSvgSourceError);
      root.remove();
    }
  });

  it("refuses missing or external paint references, duplicate IDs, and nonportable fonts", () => {
    mockStyles();
    const missing = svg(`<svg xmlns="${NS}"><rect fill="url(#absent)"/></svg>`);
    expect(() =>
      serializeNativeSvgSource(missing, { width: 20, height: 20 }),
    ).toThrow(NativeSvgSourceError);
    expect(
      captureCode(() =>
        serializeNativeSvgSource(missing, { width: 20, height: 20 }),
      ),
    ).toBe("source-svg-reference-unresolved");
    missing.remove();
    const external = svg(
      `<svg xmlns="${NS}"><rect fill="url(https://example.invalid/a.svg#ink)"/></svg>`,
    );
    expect(() =>
      serializeNativeSvgSource(external, { width: 20, height: 20 }),
    ).toThrow(NativeSvgSourceError);
    expect(
      captureCode(() =>
        serializeNativeSvgSource(external, { width: 20, height: 20 }),
      ),
    ).toBe("source-svg-external-asset");
    external.remove();
    const duplicate = svg(
      `<svg xmlns="${NS}"><rect id="same"/><circle id="same"/></svg>`,
    );
    expect(() =>
      serializeNativeSvgSource(duplicate, { width: 20, height: 20 }),
    ).toThrow(NativeSvgSourceError);
    expect(
      captureCode(() =>
        serializeNativeSvgSource(duplicate, { width: 20, height: 20 }),
      ),
    ).toBe("source-svg-id-duplicate");
    duplicate.remove();
    const font = svg(
      `<svg xmlns="${NS}"><text font-family="RemoteFont">Hello</text></svg>`,
    );
    expect(() =>
      serializeNativeSvgSource(font, { width: 20, height: 20 }),
    ).toThrow(NativeSvgSourceError);
    expect(
      captureCode(() =>
        serializeNativeSvgSource(font, { width: 20, height: 20 }),
      ),
    ).toBe("source-svg-font-unsupported");
  });

  it("retains computed linear RGB vector blending and rejects unsupported text presentation", () => {
    mockStyles();
    const linear = svg(
      `<svg xmlns="${NS}"><rect width="20" height="20"/></svg>`,
    );
    linear.setAttribute("data-test-color-interpolation", "linearRGB");
    expect(
      serializeNativeSvgSource(linear, { width: 20, height: 20 }),
    ).toContain('color-interpolation="linearRGB"');
    linear.remove();
    const text = svg(`<svg xmlns="${NS}"><text>Vector</text></svg>`);
    const glyph = text.querySelector("text")!;
    for (const [attribute, value] of [
      ["data-test-font-stretch", "condensed"],
      ["data-test-font-variant", "small-caps"],
      ["data-test-font-variant-caps", "small-caps"],
      ["data-test-font-feature-settings", '"ss01" 1'],
      ["data-test-font-variation-settings", '"wght" 700'],
      ["data-test-text-decoration-line", "underline"],
    ]) {
      glyph.setAttribute(attribute, value);
      expect(
        captureCode(() =>
          serializeNativeSvgSource(text, { width: 20, height: 20 }),
        ),
      ).toBe("source-svg-text-style-unsupported");
      glyph.removeAttribute(attribute);
    }
    glyph.setAttribute("color-interpolation", "unreadable");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(text, { width: 20, height: 20 }),
      ),
    ).toBe("source-svg-color-interpolation-unsupported");
  });

  it("serializes a bounded root overflow edge while rejecting unreadable box paint", () => {
    mockStyles();
    const root = svg(`<svg xmlns="${NS}"><rect width="20" height="20"/></svg>`);
    root.setAttribute("data-test-radius", "8px");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 20, height: 20 }),
      ),
    ).toBe("source-svg-root-radius-unsupported");
    root.removeAttribute("data-test-radius");
    root.setAttribute("data-test-overflow-margin", "content-box");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 20, height: 20 }),
      ),
    ).toBeNull();
    root.setAttribute("data-test-overflow-margin", "12px");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 20, height: 20 }),
      ),
    ).toBeNull();
    root.setAttribute("data-test-overflow", "clip");
    const expanded = serializeNativeSvgSource(root, { width: 20, height: 20 });
    expect(expanded).toContain("overflow-clip-margin:padding-box 12px");
    expect(expanded).toContain('overflow="clip"');
    root.setAttribute("data-test-overflow-margin", "content-box 0px");
    expect(serializeNativeSvgSource(root, { width: 20, height: 20 })).toContain(
      "overflow-clip-margin:content-box 0px",
    );
    root.removeAttribute("data-test-overflow-margin");
    root.removeAttribute("data-test-overflow");
    root.setAttribute("data-test-padding", "4px");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 20, height: 20 }),
      ),
    ).toBe("source-svg-box-paint-unsupported");
    root.removeAttribute("data-test-padding");
    root.setAttribute("data-test-mask", "none 0% 0% / auto repeat");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 20, height: 20 }),
      ),
    ).toBeNull();
    root.setAttribute("data-test-mask-image", "url(#mask)");
    expect(
      captureCode(() =>
        serializeNativeSvgSource(root, { width: 20, height: 20 }),
      ),
    ).toBe("source-svg-composite-unsupported");
  });

  it("captures one SVG leaf in source order and retires it after removal", async () => {
    const target = document.createElement("div");
    const source = svg(
      `<svg xmlns="${NS}" viewBox="0 0 40 30" opacity="0.5"><rect x="0" y="0" width="40" height="30" fill="red"/></svg>`,
    );
    source.remove();
    target.append(source);
    document.body.append(target);
    Object.defineProperties(target, {
      offsetWidth: { configurable: true, value: 80 },
      offsetHeight: { configurable: true, value: 60 },
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === source) return new DOMRect(10, 12, 40, 30);
        if (this === target) return new DOMRect(0, 0, 80, 60);
        return new DOMRect(0, 0, 100, 100);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          display: "block",
          visibility: "visible",
          opacity:
            element === target
              ? "0.7"
              : (element.getAttribute("opacity") ?? "1"),
          position: "static",
          transform: "none",
          transformOrigin: "0px 0px",
          translate: "none",
          rotate: "none",
          scale: "none",
          perspective: "none",
          transformStyle: "flat",
          isolation: "auto",
          zIndex: "auto",
          order: "0",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          backgroundImage: "none",
          backgroundColor: "transparent",
          boxShadow: "none",
          outlineStyle: "none",
          clipPath: "none",
          maskImage: "none",
          overflow: element === source ? "hidden" : "visible",
          overflowX: "visible",
          overflowY: "visible",
          borderTopWidth: "0px",
          borderRightWidth: "0px",
          borderBottomWidth: "0px",
          borderLeftWidth: "0px",
          borderTopLeftRadius: "0px",
          borderTopRightRadius: "0px",
          borderBottomRightRadius: "0px",
          borderBottomLeftRadius: "0px",
          paddingTop: "0px",
          paddingRight: "0px",
          paddingBottom: "0px",
          paddingLeft: "0px",
          fill: element.getAttribute("fill") ?? "black",
          fontFamily: "sans-serif",
          getPropertyValue: () => "0px",
          content: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    vi.spyOn(source, "getAnimations").mockReturnValue([]);
    vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(
      Object.assign(document.createElement("canvas"), {
        width: 40,
        height: 30,
      }),
    );
    const provider = createNativeSceneProvider(target, "layer");
    try {
      const first = await provider!.readScene();
      const svgRecords = first.filter((record) => record.node === source);
      expect(svgRecords).toHaveLength(1);
      expect(svgRecords[0]).toMatchObject({
        kind: "dom",
        rect: { x: 10, y: 12, width: 40, height: 30 },
        localBox: { x: 0, y: 0, width: 40, height: 30 },
        isolationPath: [
          expect.objectContaining({ kind: "opacity", opacity: 0.7 }),
        ],
      });
      expect(provider!.diagnosticSnapshot().leaves).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "svg" })]),
      );
      source.setAttribute("style", "overflow:hidden");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(
        provider!
          .diagnosticSnapshot()
          .leaves.find((leaf) => leaf.kind === "svg")?.observedAttributes,
      ).toEqual([]);
      document.documentElement.setAttribute(
        "data-an-native-source-idle-observer",
        "",
      );
      source.setAttribute("style", "overflow:hidden;opacity:0.5");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(
        provider!
          .diagnosticSnapshot()
          .leaves.find((leaf) => leaf.kind === "svg")?.observedAttributes,
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "style" })]),
      );
      source.remove();
      await provider!.readScene();
      expect(provider!.diagnosticSnapshot()).toMatchObject({
        activeLeaves: 0,
        retiredLeaves: 1,
      });
    } finally {
      provider?.dispose();
      document.documentElement.removeAttribute(
        "data-an-native-source-idle-observer",
      );
    }
  });

  it("keeps decoded SVG raster pixels bounded and releases the image handle", async () => {
    mockStyles();
    const source = svg(
      `<svg xmlns="${NS}"><rect width="20" height="12"/></svg>`,
    );
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 20, 12),
    );
    const images: Array<{ src: string }> = [];
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        constructor() {
          images.push(this);
        }
        async decode() {}
      },
    );
    const canvas = document.createElement("canvas");
    const draw = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    await rasterNativeSvgSource(source, canvas, 2);
    expect(canvas.width).toBe(40);
    expect(canvas.height).toBe(24);
    expect(draw).toHaveBeenCalledWith(expect.any(Object), 0, 0, 40, 24);
    expect(images[0]?.src).toBe("");
    await expect(
      rasterNativeSvgSource(source, canvas, 500),
    ).rejects.toMatchObject({
      code: "source-svg-size",
    });
  });

  it("commits an expanded SVG viewport and its exact negative capture origin", async () => {
    mockStyles();
    const source = svg(
      `<svg xmlns="${NS}"><rect x="-2" width="24" height="12"/></svg>`,
    );
    source.setAttribute("data-test-overflow", "clip");
    source.setAttribute("data-test-overflow-margin", "border-box 2px");
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 20, 12),
    );
    let serialized = "";
    vi.stubGlobal(
      "Image",
      class {
        set src(value: string) {
          if (value) serialized = decodeURIComponent(value.split(",")[1]);
        }
        async decode() {}
      },
    );
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    await rasterNativeSvgSource(source, canvas, 2);
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(32);
    expect(serialized).toContain('viewBox="-2 -2 24 16"');
    expect(nativeCaptureRoi(canvas)).toMatchObject({
      cssBox: { x: -2, y: -2, width: 24, height: 16 },
      pixelBox: { x: -4, y: -4, width: 48, height: 32 },
    });
  });
});
