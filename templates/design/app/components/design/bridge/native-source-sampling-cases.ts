// i18n-raw-literal-disable-file: Numeric test fixtures imported only by native-source-sampling.spec.ts; labels are never rendered in the UI.
import type { planNativeImageSampling } from "./native-source-sampling";

type Input = Parameters<typeof planNativeImageSampling>[0];
export const base: Input = {
  imageRendering: { value: "pixelated" },
  sourceSize: { width: 4, height: 2 },
  uploadedSize: { width: 4, height: 2 },
  localBox: { x: 20, y: 10, width: 4, height: 2 },
  localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  physicalScale: { x: 1, y: 1 },
};
export const cases: {
  name: string;
  input: Input;
  expected: ReturnType<typeof planNativeImageSampling>;
}[] = [
  {
    name: "pixelated DPR1 identity",
    input: base,
    expected: { ok: true, filter: "nearest", pixelated: { x: 1, y: 1 } },
  },
  {
    name: "pixelated DPR2 duplication",
    input: { ...base, physicalScale: { x: 2, y: 2 } },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 2 } },
  },
  {
    name: "independent integer CSS axes",
    input: { ...base, localBox: { x: 20, y: 10, width: 8, height: 6 } },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 3 } },
  },
  {
    name: "CSS fractional even with physical integer",
    input: {
      ...base,
      localBox: { x: 20, y: 10, width: 6, height: 3 },
      physicalScale: { x: 2, y: 2 },
    },
    expected: { ok: true, filter: "nearest", pixelated: { x: 3, y: 3 } },
  },
  {
    name: "fractional physical density",
    input: { ...base, physicalScale: { x: 1.6, y: 1.6 } },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 2 } },
  },
  {
    name: "fractional CSS origin even physical aligned",
    input: {
      ...base,
      localBox: { x: 20.5, y: 10, width: 4, height: 2 },
      physicalScale: { x: 2, y: 2 },
    },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 2 } },
  },
  {
    name: "contain concrete image extent",
    input: { ...base, localBox: { x: 20, y: 12, width: 8, height: 4 } },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 2 } },
  },
  {
    name: "cover uses uncropped concrete image",
    input: {
      ...base,
      localBox: { x: 20, y: 10, width: 4, height: 4 },
      uv: { x: 0.25, y: 0, width: 0.5, height: 1 },
    },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 2 } },
  },
  {
    name: "cover fractional full-object scale",
    input: {
      ...base,
      localBox: { x: 20, y: 10, width: 4, height: 3 },
      uv: { x: 1 / 6, y: 0, width: 2 / 3, height: 1 },
    },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 2 } },
  },
  {
    name: "crisp-edges fractional scale is permitted nearest",
    input: {
      ...base,
      imageRendering: { value: "crisp-edges" },
      localBox: { x: 20.5, y: 10, width: 6, height: 3 },
    },
    expected: { ok: true, filter: "nearest" },
  },
  {
    name: "crisp-edges physical minification",
    input: {
      ...base,
      imageRendering: { value: "crisp-edges" },
      physicalScale: { x: 0.5, y: 0.5 },
    },
    expected: { ok: true, filter: "nearest" },
  },
  {
    name: "pixelated CSS minification needs smooth second stage",
    input: { ...base, localBox: { x: 20, y: 10, width: 2, height: 1 } },
    expected: { ok: true, filter: "nearest", pixelated: { x: 1, y: 1 } },
  },
  {
    name: "sharp upload downsample",
    input: { ...base, uploadedSize: { width: 2, height: 1 } },
    expected: { ok: false, reason: "downsample" },
  },
  {
    name: "crisp upload downsample",
    input: {
      ...base,
      imageRendering: { value: "crisp-edges" },
      uploadedSize: { width: 2, height: 1 },
    },
    expected: { ok: false, reason: "downsample" },
  },
  {
    name: "unknown computed value",
    input: { ...base, imageRendering: { value: "" } },
    expected: { ok: false, reason: "value" },
  },
  {
    name: "unreadable computed value",
    input: {
      ...base,
      imageRendering: { value: undefined as unknown as string },
    },
    expected: { ok: false, reason: "value" },
  },
  {
    name: "nonfinite geometry",
    input: { ...base, localToTarget: { ...base.localToTarget, e: NaN } },
    expected: { ok: false, reason: "geometry" },
  },
  {
    name: "rotation",
    input: { ...base, localToTarget: { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 } },
    expected: { ok: false, reason: "geometry" },
  },
  {
    name: "shear",
    input: { ...base, localToTarget: { ...base.localToTarget, c: 0.2 } },
    expected: { ok: false, reason: "geometry" },
  },
  {
    name: "invalid crop",
    input: { ...base, uv: { x: 0.9, y: 0, width: 0.5, height: 1 } },
    expected: { ok: false, reason: "geometry" },
  },
  {
    name: "auto remains linear with bounded downsample",
    input: {
      ...base,
      imageRendering: { value: "auto" },
      uploadedSize: { width: 2, height: 1 },
    },
    expected: { ok: true, filter: "linear" },
  },
  {
    name: "smooth remains linear",
    input: { ...base, imageRendering: { value: "smooth" } },
    expected: { ok: true, filter: "linear" },
  },
  {
    name: "high-quality retains current linear",
    input: { ...base, imageRendering: { value: "high-quality" } },
    expected: { ok: true, filter: "linear" },
  },
  {
    name: "pre-rasterized DOM record retains existing policy",
    input: { ...base, imageRendering: undefined },
    expected: { ok: true, filter: "linear" },
  },
  {
    name: "deprecated speed alias",
    input: { ...base, imageRendering: { value: "optimizeSpeed" } },
    expected: { ok: true, filter: "nearest" },
  },
  {
    name: "deprecated quality alias",
    input: { ...base, imageRendering: { value: "optimizeQuality" } },
    expected: { ok: true, filter: "linear" },
  },
  {
    name: "missing crisp geometry width is unreadable",
    input: {
      ...base,
      imageRendering: { value: "crisp-edges" },
      localBox: { x: 20, y: 10, height: 2 } as typeof base.localBox,
    },
    expected: { ok: false, reason: "geometry" },
  },
  {
    name: "missing crisp physical density is unreadable",
    input: {
      ...base,
      imageRendering: { value: "crisp-edges" },
      physicalScale: { y: 1 } as typeof base.physicalScale,
    },
    expected: { ok: false, reason: "geometry" },
  },
  {
    name: "axis reflection preserves physical extent",
    input: {
      ...base,
      localToTarget: { a: -1, b: 0, c: 0, d: 1, e: 100.25, f: 0 },
      physicalScale: { x: 1.6, y: 2 },
    },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 2 } },
  },
  {
    name: "independent affine scales",
    input: {
      ...base,
      localToTarget: { a: 1.6, b: 0, c: 0, d: 0.6, e: 0.25, f: -0.5 },
    },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 1 } },
  },
  {
    name: "rounded adaptive density is read exactly",
    input: { ...base, physicalScale: { x: 410 / 256, y: 409 / 256 } },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 2 } },
  },
  {
    name: "positive halfway chooses larger equally close multiple",
    input: { ...base, physicalScale: { x: 1.5, y: 2.5 } },
    expected: { ok: true, filter: "nearest", pixelated: { x: 2, y: 3 } },
  },
  {
    name: "null policy is unreadable rather than absent",
    input: {
      ...base,
      imageRendering: null as unknown as typeof base.imageRendering,
    },
    expected: { ok: false, reason: "value" },
  },
  {
    name: "empty policy wrapper is unreadable",
    input: { ...base, imageRendering: {} as typeof base.imageRendering },
    expected: { ok: false, reason: "value" },
  },
  {
    name: "zero affine axis",
    input: { ...base, localToTarget: { ...base.localToTarget, a: 0 } },
    expected: { ok: false, reason: "geometry" },
  },
  {
    name: "nonfinite density",
    input: { ...base, physicalScale: { x: Infinity, y: 1 } },
    expected: { ok: false, reason: "geometry" },
  },
  {
    name: "virtual half-texel precision bound",
    input: { ...base, physicalScale: { x: 3_000_000, y: 1 } },
    expected: { ok: false, reason: "pixelated-scale" },
  },
  {
    name: "sharp original extent must be an integer",
    input: { ...base, sourceSize: { width: 4.5, height: 2 } },
    expected: { ok: false, reason: "geometry" },
  },
];

export type SamplingPixel = [number, number, number, number];
export type NumericSamplingCase = {
  name: string;
  input: Input;
  pixels: SamplingPixel[];
  referenceMultiple: { x: number; y: number };
  premultiplied: boolean;
  sites: { uv: [number, number]; expected?: SamplingPixel }[];
};
const gray = (value: number): SamplingPixel => [value, value, value, 1];
const gray5 = [0, 0.25, 0.5, 0.75, 1].map(gray);
const numericInput = (
  width: number,
  height: number,
  scaleX: number,
  scaleY = scaleX,
): Input => ({
  ...base,
  sourceSize: { width, height },
  uploadedSize: { width, height },
  localBox: { x: 0, y: 0, width, height },
  physicalScale: { x: scaleX, y: scaleY },
});
const centers = (width: number, height: number): [number, number][] =>
  Array.from({ length: width * height }, (_, index) => [
    ((index % width) + 0.5) / width,
    (Math.floor(index / width) + 0.5) / height,
  ]);
const grayscaleSites = (values: number[]) =>
  values.map((value, index) => ({
    uv: [(index + 0.5) / values.length, 0.5] as [number, number],
    expected: gray(value),
  }));
const split: SamplingPixel[] = [
  [0, 0, 0, 1],
  [1, 1, 1, 1],
];
export const numericCases: NumericSamplingCase[] = [
  {
    name: "1.6 physical scale: hardcoded two-stage colors",
    input: numericInput(5, 1, 1.6),
    pixels: gray5,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: grayscaleSites([
      0, 0.09375, 0.25, 0.46875, 0.53125, 0.75, 0.90625, 1,
    ]),
  },
  {
    name: "integer DPR1 exact texels",
    input: numericInput(5, 1, 1),
    pixels: gray5,
    referenceMultiple: { x: 1, y: 1 },
    premultiplied: false,
    sites: grayscaleSites([0, 0.25, 0.5, 0.75, 1]),
  },
  {
    name: "integer DPR2 exact duplicated texels",
    input: numericInput(5, 1, 2),
    pixels: gray5,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: grayscaleSites([0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1]),
  },
  {
    name: "1.5 tie keeps midpoint smoothing",
    input: numericInput(2, 1, 1.5),
    pixels: split,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: grayscaleSites([0, 0.5, 1]),
  },
  {
    name: "2.5 tie chooses threefold intermediate",
    input: numericInput(2, 1, 2.5),
    pixels: split,
    referenceMultiple: { x: 3, y: 3 },
    premultiplied: false,
    sites: grayscaleSites([0, 0, 0.5, 1, 1]),
  },
  {
    name: "minification uses onefold intermediate with smooth final",
    input: numericInput(5, 1, 0.6),
    pixels: gray5,
    referenceMultiple: { x: 1, y: 1 },
    premultiplied: false,
    sites: grayscaleSites([1 / 12, 0.5, 11 / 12]),
  },
  {
    name: "independent axis filtering",
    input: numericInput(2, 2, 1.6, 2.6),
    pixels: [
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
      [1, 1, 1, 1],
    ],
    referenceMultiple: { x: 2, y: 3 },
    premultiplied: false,
    sites: centers(3, 5).map((uv) => ({ uv })),
  },
  {
    name: "cover uses full object rather than visible crop",
    input: {
      ...numericInput(5, 1, 1.6),
      localBox: { x: 20, y: 10, width: 4, height: 1 },
      uv: { x: 0.1, y: 0, width: 0.8, height: 1 },
    },
    pixels: gray5,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: [0.15, 0.25, 0.45, 0.55, 0.75, 0.85].map((x) => ({ uv: [x, 0.5] })),
  },
  {
    name: "contain concrete extent includes letterbox position",
    input: {
      ...numericInput(5, 1, 1.6),
      localBox: { x: 3.25, y: 10.75, width: 10, height: 2 },
    },
    pixels: gray5,
    referenceMultiple: { x: 3, y: 3 },
    premultiplied: false,
    sites: centers(16, 3).map((uv) => ({ uv })),
  },
  {
    name: "fractional physical origin preserves source phase",
    input: {
      ...numericInput(5, 1, 1.6),
      localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0.25, f: 0.125 },
    },
    pixels: gray5,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: Array.from({ length: 8 }, (_, x) => ({
      uv: [(x + 0.5 - 0.4) / 8, 0.5] as [number, number],
    })),
  },
  {
    name: "axis reflection uses mirrored UV and positive extent",
    input: {
      ...numericInput(5, 1, 1.6),
      localToTarget: { a: -1, b: 0, c: 0, d: 1, e: 5, f: 0 },
    },
    pixels: gray5,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: [1, 0.90625, 0.75, 0.53125, 0.46875, 0.25, 0.09375, 0].map(
      (value, x) => ({
        uv: [1 - (x + 0.5) / 8, 0.5],
        expected: gray(value),
      }),
    ),
  },
  {
    name: "affine scaling uses total physical footprint",
    input: {
      ...numericInput(5, 1, 1),
      localToTarget: { a: 1.6, b: 0, c: 0, d: 1.6, e: 0, f: 0 },
    },
    pixels: gray5,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: grayscaleSites([
      0, 0.09375, 0.25, 0.46875, 0.53125, 0.75, 0.90625, 1,
    ]),
  },
  {
    name: "transparent hidden green does not contaminate red",
    input: numericInput(2, 1, 1.6),
    pixels: [
      [1, 0, 0, 1],
      [0, 1, 0, 0],
    ],
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: [
      { uv: [0.5, 0.5], expected: [0.5, 0, 0, 0.5] },
      { uv: [1, 0.5], expected: [0, 0, 0, 0] },
    ],
  },
  {
    name: "half-alpha raw input filters associated color",
    input: numericInput(2, 1, 1.6),
    pixels: [
      [1, 0, 0, 0.5],
      [0, 0, 1, 1],
    ],
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: [{ uv: [0.5, 0.5], expected: [0.25, 0, 0.5, 0.75] }],
  },
  {
    name: "native premultiplied input uses same colors",
    input: numericInput(2, 1, 1.6),
    pixels: [
      [0.5, 0, 0, 0.5],
      [0, 0, 1, 1],
    ],
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: true,
    sites: [{ uv: [0.5, 0.5], expected: [0.25, 0, 0.5, 0.75] }],
  },
  {
    name: "all-zero alpha yields empty coverage",
    input: numericInput(2, 1, 1.6),
    pixels: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ],
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: centers(3, 1).map((uv) => ({ uv, expected: [0, 0, 0, 0] })),
  },
  {
    name: "rounded adaptive extent uses exact output ratio",
    input: numericInput(5, 1, 410 / 256, 409 / 256),
    pixels: gray5,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map((x) => ({
      uv: [x / ((5 * 410) / 256), 0.5],
    })),
  },
  {
    name: "crop and target both resize",
    input: {
      ...numericInput(5, 1, 1.6),
      localBox: { x: 20.5, y: 10, width: 3, height: 1 },
      uv: { x: 0.25, y: 0, width: 0.5, height: 1 },
    },
    pixels: gray5,
    referenceMultiple: { x: 2, y: 2 },
    premultiplied: false,
    sites: [0.3125, 0.4375, 0.5625, 0.6875].map((x) => ({ uv: [x, 0.5] })),
  },
];

function associated(
  pixel: SamplingPixel,
  premultiplied: boolean,
): SamplingPixel {
  return premultiplied
    ? [...pixel]
    : [pixel[0] * pixel[3], pixel[1] * pixel[3], pixel[2] * pixel[3], pixel[3]];
}

// Test-only reference allocates the literal nearest-expanded image, independently of virtual indices.
export function materializedPixelatedReference(
  fixture: NumericSamplingCase,
  uv: [number, number],
): SamplingPixel {
  const { width, height } = fixture.input.sourceSize;
  const k = fixture.referenceMultiple;
  const expanded: SamplingPixel[] = [];
  for (let row = 0; row < height; row++) {
    const line: SamplingPixel[] = [];
    for (let column = 0; column < width; column++) {
      const value = associated(
        fixture.pixels[row * width + column],
        fixture.premultiplied,
      );
      for (let repeat = 0; repeat < k.x; repeat++) line.push(value);
    }
    for (let repeat = 0; repeat < k.y; repeat++) expanded.push(...line);
  }
  const w = width * k.x,
    h = height * k.y;
  const x = Math.max(0, Math.min(1, uv[0])) * w - 0.5;
  const y = Math.max(0, Math.min(1, uv[1])) * h - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fractionX = x - ix,
    fractionY = y - iy;
  const result: SamplingPixel = [0, 0, 0, 0];
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const column = Math.max(0, Math.min(w - 1, ix + dx));
      const row = Math.max(0, Math.min(h - 1, iy + dy));
      const weight =
        (dx ? fractionX : 1 - fractionX) * (dy ? fractionY : 1 - fractionY);
      for (let channel = 0; channel < 4; channel++)
        result[channel] += expanded[row * w + column][channel] * weight;
    }
  return result;
}

// Test-only f32 equation model; it is not an execution of the generated WGSL.
export function virtualPixelatedModel(
  fixture: NumericSamplingCase,
  uv: [number, number],
  multiple: { x: number; y: number },
): SamplingPixel {
  const f = Math.fround;
  const extent = fixture.input.sourceSize;
  const axis = (coordinate: number, count: number, repeat: number) => {
    const intermediate = f(f(count) * f(repeat));
    const position = f(
      f(f(Math.max(0, Math.min(1, f(coordinate)))) * intermediate) - f(0.5),
    );
    const low = Math.floor(position);
    return {
      first: Math.floor(
        f(f(Math.max(0, Math.min(intermediate - 1, low))) / f(repeat)),
      ),
      second: Math.floor(
        f(f(Math.max(0, Math.min(intermediate - 1, low + 1))) / f(repeat)),
      ),
      fraction: f(position - low),
    };
  };
  const x = axis(uv[0], extent.width, multiple.x),
    y = axis(uv[1], extent.height, multiple.y);
  const load = (column: number, row: number): SamplingPixel => {
    const value = fixture.pixels[row * extent.width + column].map(
      f,
    ) as SamplingPixel;
    return fixture.premultiplied
      ? value
      : [
          f(value[0] * value[3]),
          f(value[1] * value[3]),
          f(value[2] * value[3]),
          value[3],
        ];
  };
  const mix = (
    a: SamplingPixel,
    b: SamplingPixel,
    weight: number,
  ): SamplingPixel =>
    a.map((value, channel) =>
      f(f(value * f(1 - weight)) + f(b[channel] * weight)),
    ) as SamplingPixel;
  const value = mix(
    mix(load(x.first, y.first), load(x.second, y.first), x.fraction),
    mix(load(x.first, y.second), load(x.second, y.second), x.fraction),
    y.fraction,
  );
  if (fixture.premultiplied) return value;
  if (value[3] <= 0) return [0, 0, 0, 0];
  return [
    f(f(value[0] / value[3]) * value[3]),
    f(f(value[1] / value[3]) * value[3]),
    f(f(value[2] / value[3]) * value[3]),
    value[3],
  ];
}

export const physicalCases = [
  numericCases[0],
  numericCases[7],
  numericCases[8],
  numericCases[9],
  numericCases[10],
  numericCases[11],
  numericCases[16],
  numericCases[17],
];

export function physicalSamplingSites(input: Input): [number, number][] {
  const {
    localBox: box,
    localToTarget: transform,
    physicalScale: density,
  } = input;
  const left = (transform.a * box.x + transform.e) * density.x;
  const top = (transform.d * box.y + transform.f) * density.y;
  const width = transform.a * box.width * density.x;
  const height = transform.d * box.height * density.y;
  return [-0.125, 0.0625, 0.1875, 0.4375, 0.5625, 0.8125, 0.9375, 1.125].map(
    (t) => [left + width * t, top + height * 0.5],
  );
}

export function referencePhysicalUv(
  input: Input,
  point: [number, number],
): [number, number] | null {
  const {
    localBox: box,
    localToTarget: transform,
    physicalScale: density,
  } = input;
  const crop = input.uv ?? { x: 0, y: 0, width: 1, height: 1 };
  const visibleLeft = (transform.a * box.x + transform.e) * density.x;
  const visibleTop = (transform.d * box.y + transform.f) * density.y;
  const visibleWidth = transform.a * box.width * density.x;
  const visibleHeight = transform.d * box.height * density.y;
  const tx = (point[0] - visibleLeft) / visibleWidth;
  const ty = (point[1] - visibleTop) / visibleHeight;
  if (tx < 0 || tx > 1 || ty < 0 || ty > 1) return null;
  const fullWidth = visibleWidth / crop.width,
    fullHeight = visibleHeight / crop.height;
  const fullLeft = visibleLeft - crop.x * fullWidth;
  const fullTop = visibleTop - crop.y * fullHeight;
  return [(point[0] - fullLeft) / fullWidth, (point[1] - fullTop) / fullHeight];
}

export function modelPhysicalUv(
  input: Input,
  point: [number, number],
): [number, number] | null {
  const f = Math.fround;
  const {
    localBox: box,
    localToTarget: transform,
    physicalScale: density,
  } = input;
  const crop = input.uv ?? { x: 0, y: 0, width: 1, height: 1 };
  const localX = f(
    f(f(point[0]) * f(1 / (transform.a * density.x))) +
      f(-transform.e / transform.a),
  );
  const localY = f(
    f(f(point[1]) * f(1 / (transform.d * density.y))) +
      f(-transform.f / transform.d),
  );
  const tx = f(f(localX - f(box.x)) / f(box.width));
  const ty = f(f(localY - f(box.y)) / f(box.height));
  if (tx < 0 || tx > 1 || ty < 0 || ty > 1) return null;
  return [
    f(f(crop.x) + f(tx * f(crop.width))),
    f(f(crop.y) + f(ty * f(crop.height))),
  ];
}
