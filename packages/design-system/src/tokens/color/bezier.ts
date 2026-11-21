import { at } from "../at.js";

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;
const SPLINE_TABLE_SIZE = 11;
const SAMPLE_STEP_SIZE = 1 / (SPLINE_TABLE_SIZE - 1);

const a = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
const b = (a1: number, a2: number) => 3 * a2 - 6 * a1;
const c = (a1: number) => 3 * a1;

function calcBezier(t: number, a1: number, a2: number): number {
  return ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t;
}

function getSlope(t: number, a1: number, a2: number): number {
  return 3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1);
}

function binarySubdivide(
  x: number,
  start: number,
  end: number,
  x1: number,
  x2: number,
): number {
  let currentX: number;
  let currentT: number;
  let i = 0;
  do {
    currentT = start + (end - start) / 2;
    currentX = calcBezier(currentT, x1, x2) - x;
    if (currentX > 0) end = currentT;
    else start = currentT;
  } while (
    Math.abs(currentX) > SUBDIVISION_PRECISION &&
    ++i < SUBDIVISION_MAX_ITERATIONS
  );
  return currentT;
}

function newtonRaphsonIterate(
  x: number,
  guessT: number,
  x1: number,
  x2: number,
): number {
  let t = guessT;
  for (let i = 0; i < NEWTON_ITERATIONS; ++i) {
    const slope = getSlope(t, x1, x2);
    if (slope === 0) return t;
    t -= (calcBezier(t, x1, x2) - x) / slope;
  }
  return t;
}

export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (x: number) => number {
  if (!(0 <= x1 && x1 <= 1 && 0 <= x2 && x2 <= 1)) {
    throw new RangeError("Bezier x values must be in the [0, 1] range");
  }
  if (x1 === y1 && x2 === y2) return (x) => x;

  const samples = new Float32Array(SPLINE_TABLE_SIZE);
  for (let i = 0; i < SPLINE_TABLE_SIZE; ++i) {
    samples[i] = calcBezier(i * SAMPLE_STEP_SIZE, x1, x2);
  }

  function getTForX(x: number): number {
    let intervalStart = 0;
    let currentSample = 1;
    const lastSample = SPLINE_TABLE_SIZE - 1;
    for (
      ;
      currentSample !== lastSample && at(samples, currentSample) <= x;
      ++currentSample
    ) {
      intervalStart += SAMPLE_STEP_SIZE;
    }
    --currentSample;

    const dist =
      (x - at(samples, currentSample)) /
      (at(samples, currentSample + 1) - at(samples, currentSample));
    const guessT = intervalStart + dist * SAMPLE_STEP_SIZE;
    const initialSlope = getSlope(guessT, x1, x2);
    if (initialSlope >= NEWTON_MIN_SLOPE) {
      return newtonRaphsonIterate(x, guessT, x1, x2);
    }
    if (initialSlope === 0) return guessT;
    return binarySubdivide(
      x,
      intervalStart,
      intervalStart + SAMPLE_STEP_SIZE,
      x1,
      x2,
    );
  }

  return (x) => {
    if (x === 0) return 0;
    if (x === 1) return 1;
    return calcBezier(getTForX(x), y1, y2);
  };
}
