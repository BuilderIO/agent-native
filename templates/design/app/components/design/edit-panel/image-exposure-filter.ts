/**
 * Figma's Exposure is not a per-channel curve. Brightening scales each linear
 * channel by a luminance gain (clipping per channel, which keeps hue) and then
 * lifts toward white by luminance; darkening multiplies a channel curve by a
 * luminance curve. Tables are fitted to Figma exports of a colour grid.
 */
const EXPOSURE_TABLES = new Map<number, { t: number[]; h: number[] }>([
  [
    -100,
    {
      t: [
        0, 0.019, 0.039, 0.018, 0.063, 0.106, 0.069, 0.11, 0.161, 0.149, 0.167,
        0.215, 0.229, 0.271, 0.303, 0.35, 0.424,
      ],
      h: [
        0.266, 0.371, 0.39, 0.408, 0.383, 0.426, 0.397, 0.432, 0.434, 0.44,
        0.484, 0.46, 0.525, 0.538, 0.565, 0.666, 0.902,
      ],
    },
  ],
  [
    -75,
    {
      t: [
        0, 0.025, 0.06, 0.027, 0.102, 0.155, 0.107, 0.158, 0.242, 0.227, 0.242,
        0.337, 0.343, 0.408, 0.47, 0.528, 0.641,
      ],
      h: [
        0.479, 0.429, 0.453, 0.469, 0.43, 0.49, 0.447, 0.494, 0.491, 0.5, 0.552,
        0.518, 0.596, 0.606, 0.626, 0.743, 0.984,
      ],
    },
  ],
  [
    -50,
    {
      t: [
        0, 0.041, 0.086, 0.039, 0.144, 0.224, 0.151, 0.229, 0.346, 0.326, 0.355,
        0.47, 0.482, 0.575, 0.652, 0.738, 0.862,
      ],
      h: [
        0.719, 0.524, 0.558, 0.57, 0.531, 0.597, 0.548, 0.603, 0.597, 0.608,
        0.653, 0.628, 0.698, 0.711, 0.731, 0.826, 1,
      ],
    },
  ],
  [
    -25,
    {
      t: [
        0, 0.049, 0.106, 0.064, 0.185, 0.268, 0.217, 0.31, 0.412, 0.434, 0.5,
        0.571, 0.621, 0.711, 0.791, 0.866, 0.965,
      ],
      h: [
        0.879, 0.731, 0.759, 0.763, 0.749, 0.788, 0.765, 0.799, 0.791, 0.802,
        0.823, 0.82, 0.861, 0.864, 0.882, 0.942, 1,
      ],
    },
  ],
  [
    25,
    {
      t: [
        0.0866, 0.0722, 0.0641, 0.0552, 0.0489, 0.0468, 0.0422, 0.0409, 0.0388,
        0.0375, 0.0366, 0.0354, 0.0347, 0.0357, 0.0316, 0.0358, 0.0312,
      ],
      h: [
        0, 0.019, 0.056, 0.108, 0.161, 0.21, 0.277, 0.297, 0.351, 0.389, 0.427,
        0.452, 0.492, 0.525, 0.576, 0.578, 0.647,
      ],
    },
  ],
  [
    50,
    {
      t: [
        0.2192, 0.1424, 0.0929, 0.0777, 0.0669, 0.0578, 0.0463, 0.045, 0.0419,
        0.0397, 0.0382, 0.0373, 0.0358, 0.038, 0.0315, 0.0355, 0.0304,
      ],
      h: [
        0, 0.107, 0.288, 0.397, 0.482, 0.562, 0.647, 0.663, 0.711, 0.74, 0.768,
        0.779, 0.805, 0.825, 0.851, 0.855, 0.912,
      ],
    },
  ],
  [
    75,
    {
      t: [
        0.4995, 0.1878, 0.1244, 0.0836, 0.0734, 0.0647, 0.0582, 0.045, 0.0439,
        0.0417, 0.0405, 0.039, 0.0395, 0.0376, 0.0295, 0.0365, 0.0312,
      ],
      h: [
        0, 0.405, 0.615, 0.724, 0.777, 0.821, 0.852, 0.875, 0.894, 0.909, 0.92,
        0.924, 0.935, 0.94, 0.953, 0.95, 0.962,
      ],
    },
  ],
  [
    100,
    {
      t: [
        0.9362, 0.1825, 0.1554, 0.088, 0.0781, 0.0708, 0.0607, 0.0426, 0.0397,
        0.0373, 0.0326, 0.0388, 0.0371, 0.0346, 0.0313, 0.0311, 0.0312,
      ],
      h: [
        0.027, 0.79, 0.825, 0.905, 0.919, 0.938, 0.952, 0.957, 0.968, 0.969,
        0.976, 0.972, 0.982, 0.982, 0.981, 0.985, 0.979,
      ],
    },
  ],
]);

/** Brightening gain headroom: `t` stores gain / GAIN so tables stay in 0..1. */
const GAIN = 32;
const KNOTS = 17;
const IDENTITY = Array.from(
  { length: KNOTS },
  (_, index) => index / (KNOTS - 1),
);
const EXPOSURE_ID = /#an-exposure-(-?\d+)/;
const EXPOSURE_URL =
  /url\(\s*["']?data:image\/svg\+xml[^)]*#an-exposure-(-?\d+)["']?\s*\)/g;

function tablesFor(value: number): { t: number[]; h: number[] } {
  const sign = Math.sign(value);
  const identity =
    sign < 0
      ? { t: IDENTITY, h: IDENTITY.map(() => 1) }
      : { t: IDENTITY.map(() => 1 / GAIN), h: IDENTITY.map(() => 0) };
  const magnitude = Math.min(100, Math.abs(value));
  const lower = Math.floor(magnitude / 25) * 25;
  const upper = Math.min(100, lower + 25);
  const from = lower === 0 ? identity : EXPOSURE_TABLES.get(sign * lower)!;
  const to = EXPOSURE_TABLES.get(sign * upper)!;
  const ratio = upper === lower ? 0 : (magnitude - lower) / (upper - lower);
  const mix = (a: number[], b: number[]) =>
    a.map(
      (v, index) => Math.round((v + (b[index]! - v) * ratio) * 10000) / 10000,
    );
  return { t: mix(from.t, to.t), h: mix(from.h, to.h) };
}

const funcs = (values: number[]) =>
  ["R", "G", "B"]
    .map(
      (channel) =>
        `<feFunc${channel} type="table" tableValues="${values.join(" ")}"/>`,
    )
    .join("");

/** A self-contained `url(data:…)` filter, so duplicates and moves carry it. */
export function exposureFilterUrl(value: number): string {
  const rounded = Math.round(value);
  const { t, h } = tablesFor(rounded);
  const brighten = rounded > 0;
  // Colour maths runs on an opaque copy; alpha is restored at the end so
  // anti-aliased edges keep their coverage.
  const opaque = `<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1" result="o"/>`;
  const luma = `<feColorMatrix in="o" type="matrix" values="${"0.2126 0.7152 0.0722 0 0 ".repeat(3)}0 0 0 0 1" result="l"/>`;
  const body = brighten
    ? `<feComponentTransfer in="l" result="g">${funcs(t)}</feComponentTransfer><feComposite in="o" in2="g" operator="arithmetic" k1="${GAIN}" k2="0" k3="0" k4="0" result="u"/><feComponentTransfer in="l" result="h">${funcs(h)}</feComponentTransfer><feComposite in="u" in2="h" operator="arithmetic" k1="-1" k2="1" k3="1" k4="0" result="c"/>`
    : `<feComponentTransfer in="o" result="t">${funcs(t)}</feComponentTransfer><feComponentTransfer in="l" result="g">${funcs(h)}</feComponentTransfer><feComposite in="t" in2="g" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="c"/>`;
  const id = `an-exposure-${rounded}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="${id}" color-interpolation-filters="${brighten ? "linearRGB" : "sRGB"}">${opaque}${luma}${body}<feComposite in="c" in2="SourceGraphic" operator="in"/></filter></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}#${id}")`;
}

export function exposureFromFilter(filter: string | undefined): number {
  const match = filter?.match(EXPOSURE_ID);
  return match ? Number(match[1]) : 0;
}

export function withoutExposureFilter(filter: string): string {
  return filter.replace(EXPOSURE_URL, " ");
}
