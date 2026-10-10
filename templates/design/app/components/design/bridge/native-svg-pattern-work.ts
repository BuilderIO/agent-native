import type { NativeAffine2D } from "./native-source-affine-geometry";

export const MAX_NATIVE_SVG_PATTERN_WORK = 8_388_608;

type Fraction = { numerator: bigint; denominator: bigint };

// Exact binary ratios keep tiny tiles and nearly cancelling determinants from understating work.
function fraction(value: number): Fraction {
  if (value === 0) return { numerator: 0n, denominator: 1n };
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const significand =
    (bits & ((1n << 52n) - 1n)) | (exponent === 0 ? 0n : 1n << 52n);
  const shift = exponent === 0 ? -1074 : exponent - 1075;
  const numerator = bits >> 63n === 0n ? significand : -significand;
  return shift >= 0
    ? { numerator: numerator << BigInt(shift), denominator: 1n }
    : { numerator, denominator: 1n << BigInt(-shift) };
}

function multiply(first: Fraction, second: Fraction): Fraction {
  return {
    numerator: first.numerator * second.numerator,
    denominator: first.denominator * second.denominator,
  };
}

function add(first: Fraction, second: Fraction): Fraction {
  return {
    numerator:
      first.numerator * second.denominator +
      second.numerator * first.denominator,
    denominator: first.denominator * second.denominator,
  };
}

function absolute(value: Fraction): Fraction {
  return {
    numerator: value.numerator < 0n ? -value.numerator : value.numerator,
    denominator: value.denominator,
  };
}

function repeatCount(
  span: Fraction,
  determinant: Fraction,
  tile: Fraction,
): bigint {
  const divisor = multiply(determinant, tile);
  const numerator = span.numerator * divisor.denominator;
  const denominator = span.denominator * divisor.numerator;
  return (numerator + denominator - 1n) / denominator + 2n;
}

export function planNativeSvgPatternWork(input: {
  viewport: { width: number; height: number };
  localToScreen: NativeAffine2D;
  tile: { width: number; height: number };
  resourceNodes: number;
}):
  | { ok: true; repeatsX: number; repeatsY: number; workUnits: number }
  | { ok: false; reason: "invalid-input" | "singular" | "work-limit" } {
  const { viewport, localToScreen, tile, resourceNodes } = input;
  if (
    ![viewport.width, viewport.height, tile.width, tile.height].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    ![
      localToScreen.a,
      localToScreen.b,
      localToScreen.c,
      localToScreen.d,
      localToScreen.e,
      localToScreen.f,
    ].every(Number.isFinite) ||
    !Number.isSafeInteger(resourceNodes) ||
    resourceNodes <= 0 ||
    resourceNodes > MAX_NATIVE_SVG_PATTERN_WORK
  )
    return { ok: false, reason: "invalid-input" };
  const a = fraction(localToScreen.a);
  const b = fraction(localToScreen.b);
  const c = fraction(localToScreen.c);
  const d = fraction(localToScreen.d);
  const ad = multiply(a, d);
  const bc = multiply(b, c);
  const determinant = absolute(
    add(ad, { numerator: -bc.numerator, denominator: bc.denominator }),
  );
  if (determinant.numerator === 0n) return { ok: false, reason: "singular" };
  const width = fraction(viewport.width);
  const height = fraction(viewport.height);
  const spanX = add(
    multiply(absolute(d), width),
    multiply(absolute(c), height),
  );
  const spanY = add(
    multiply(absolute(b), width),
    multiply(absolute(a), height),
  );
  const repeatsX = repeatCount(spanX, determinant, fraction(tile.width));
  const repeatsY = repeatCount(spanY, determinant, fraction(tile.height));
  const work = repeatsX * repeatsY * BigInt(resourceNodes);
  if (work > BigInt(MAX_NATIVE_SVG_PATTERN_WORK))
    return { ok: false, reason: "work-limit" };
  return {
    ok: true,
    repeatsX: Number(repeatsX),
    repeatsY: Number(repeatsY),
    workUnits: Number(work),
  };
}
