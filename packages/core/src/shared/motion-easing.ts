const CSS_NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const CSS_PERCENTAGE = String.raw`${CSS_NUMBER}%`;
const MOTION_EASING_VARIABLE_REFERENCE_RE =
  /^var\(--an-motion-ease-([a-z0-9][a-z0-9-]{0,63})\)$/;
const SPRING_EASING_RE =
  /^spring\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:,\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*)?\)$/i;

export function motionEaseVariableName(ease: string): string | null {
  const match = MOTION_EASING_VARIABLE_REFERENCE_RE.exec(ease);
  return match ? `--an-motion-ease-${match[1]}` : null;
}

export function isMotionEaseVariableReference(ease: string): boolean {
  return motionEaseVariableName(ease) !== null;
}

/** True only for timing functions accepted by the Motion authoring model. */
export function isValidMotionEase(ease: string): boolean {
  if (isMotionEaseVariableReference(ease)) return true;

  const value = ease.trim();
  const keyword = value.toLowerCase();
  if (
    [
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "step-start",
      "step-end",
    ].includes(keyword)
  ) {
    return true;
  }

  const spring = SPRING_EASING_RE.exec(value);
  if (keyword === "spring") return true;
  if (spring) {
    const bounce = Number(spring[1]);
    const settle = spring[2] === undefined ? 1 : Number(spring[2]);
    return bounce >= 0 && bounce <= 1 && settle >= 0.05 && settle <= 1;
  }
  if (/^spring/i.test(value)) return false;

  const bezier = new RegExp(
    `^cubic-bezier\\(\\s*(${CSS_NUMBER})\\s*,\\s*(${CSS_NUMBER})\\s*,\\s*(${CSS_NUMBER})\\s*,\\s*(${CSS_NUMBER})\\s*\\)$`,
    "i",
  ).exec(value);
  if (bezier) {
    const [, x1, , x2] = bezier;
    return (
      Number(x1) >= 0 && Number(x1) <= 1 && Number(x2) >= 0 && Number(x2) <= 1
    );
  }

  const steps =
    /^steps\(\s*(\d+)\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/i.exec(
      value,
    );
  if (steps) {
    const count = Number(steps[1]);
    const position = steps[2]?.toLowerCase();
    return (
      count > 0 &&
      Number.isSafeInteger(count) &&
      (position === "jump-none" ? count > 1 : true)
    );
  }

  const linear = /^linear\((.*)\)$/i.exec(value);
  if (!linear) return false;
  const stops = linear[1].split(",").map((stop) => stop.trim());
  if (stops.length < 2) return false;
  return stops.every((stop) =>
    new RegExp(
      `^${CSS_NUMBER}(?:\\s+${CSS_PERCENTAGE}(?:\\s+${CSS_PERCENTAGE})?)?$`,
      "i",
    ).test(stop),
  );
}

/** Resolves Motion variables and spring tokens to easing strings accepted by WAAPI. */
export function resolveMotionEaseForWebAnimations(
  ease: string,
  readCssVariable: (name: string) => string,
): string {
  const variableName = motionEaseVariableName(ease);
  let resolvedEase = ease;
  if (variableName) {
    resolvedEase = readCssVariable(variableName).trim();
    if (
      !resolvedEase ||
      isMotionEaseVariableReference(resolvedEase) ||
      !isValidMotionEase(resolvedEase)
    ) {
      throw new TypeError(
        `Motion easing variable "${variableName}" is not defined or does not resolve to a concrete easing.`,
      );
    }
  }

  if (!isValidMotionEase(resolvedEase)) {
    throw new TypeError(
      `"${resolvedEase}" is not a supported motion easing value.`,
    );
  }

  const normalized = resolvedEase.trim();
  if (normalized.toLowerCase() === "spring") {
    return springToCssLinear(0.25, 1);
  }
  const spring = SPRING_EASING_RE.exec(normalized);
  if (!spring) return resolvedEase;

  return springToCssLinear(Number(spring[1]), Number(spring[2] ?? 1));
}

function springToCssLinear(bounce: number, settle: number): string {
  const sampleCount = 16 + Math.round(bounce * 34);
  const stops = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const x = index / sampleCount;
    const value = index === sampleCount ? 1 : sampleSpring(bounce, settle, x);
    return (Math.round(value * 10_000) / 10_000).toString();
  });
  return `linear(${stops.join(", ")})`;
}

function sampleSpring(bounce: number, settle: number, x: number): number {
  if (x <= 0) return 0;
  const u = x / settle;
  if (u >= 1) return 1;
  const zeta = Math.min(1, Math.max(0.02, 1 - bounce));
  const omega = Math.log(1 / 0.001) / zeta;
  if (zeta >= 1) {
    return 1 - Math.exp(-omega * u) * (1 + omega * u);
  }
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * u);
  return (
    1 -
    decay *
      (Math.cos(omegaD * u) + ((zeta * omega) / omegaD) * Math.sin(omegaD * u))
  );
}
