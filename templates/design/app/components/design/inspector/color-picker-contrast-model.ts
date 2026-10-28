import type { Vec3 } from "@shared/color-spaces";
import type {
  TextBackground,
  TextBackgroundReason,
} from "@shared/text-background";
import {
  contrastLevel,
  contrastTargets,
  textContrastRatio,
  type ContrastLevel,
  type ContrastTargets,
  type Rgb,
} from "@shared/wcag-contrast";

/** The picker's contrast mode, apart from React. */

export type ContrastUnavailableReason = TextBackgroundReason | "text-size";

export type ContrastReading =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: ContrastUnavailableReason }
  | {
      kind: "ready";
      ratio: number;
      level: ContrastLevel;
      targets: ContrastTargets;
      large: boolean;
      background: Rgb;
    };

/**
 * What the chip shows for a text color. Without a readable text size or a
 * solid background there is no ratio to show, and none is made up.
 * `background` is null while it is being read.
 */
export function readContrast({
  large,
  background,
  linear,
  alpha,
}: {
  /** Whether WCAG counts the text as large; null when its size is unknown. */
  large: boolean | null;
  background: TextBackground | null;
  linear: Vec3;
  alpha: number;
}): ContrastReading {
  if (large === null) return { kind: "unavailable", reason: "text-size" };
  if (background === null) return { kind: "loading" };
  if (background.kind === "unavailable") {
    return { kind: "unavailable", reason: background.reason };
  }
  const targets = contrastTargets(large);
  const ratio = textContrastRatio(linear, alpha, background.color);
  return {
    kind: "ready",
    ratio,
    level: contrastLevel(ratio, targets),
    targets,
    large,
    background: background.color,
  };
}

// ── Where the square meets the target ──────────────────────────────────────

export interface ContrastBand {
  /** Saturation of the column, 0..1. */
  s: number;
  /** The failing brightness range in this column, 0..1. */
  lo: number;
  hi: number;
}

export interface ContrastPoint {
  s: number;
  v: number;
}

export interface ContrastMap {
  /** Runs of neighbouring columns that have a failing range: the dotted fill. */
  bands: ContrastBand[][];
  /** The lines where the target is met, as runs of points. */
  lines: ContrastPoint[][];
}

const BOUNDARY_STEPS = 8;

/**
 * Samples the saturation/brightness square for the colors that miss the
 * target. Each column has at most one failing range, because brightness moves
 * a color's luminance one way, so the range is found from a coarse scan and
 * its two edges refined by bisection. The edges are the lines where the
 * target is met.
 */
export function computeContrastMap(
  fails: (s: number, v: number) => boolean,
  { columns = 40, samples = 16 }: { columns?: number; samples?: number } = {},
): ContrastMap {
  const bisect = (s: number, passing: number, failing: number): number => {
    let pass = passing;
    let fail = failing;
    for (let step = 0; step < BOUNDARY_STEPS; step += 1) {
      const middle = (pass + fail) / 2;
      if (fails(s, middle)) fail = middle;
      else pass = middle;
    }
    return (pass + fail) / 2;
  };

  const bands: ContrastBand[][] = [];
  const lowerLines: ContrastPoint[][] = [];
  const upperLines: ContrastPoint[][] = [];
  let band: ContrastBand[] | null = null;
  let lower: ContrastPoint[] | null = null;
  let upper: ContrastPoint[] | null = null;

  for (let column = 0; column < columns; column += 1) {
    const s = column / (columns - 1);
    const flags: boolean[] = [];
    for (let sample = 0; sample <= samples; sample += 1) {
      flags.push(fails(s, sample / samples));
    }
    const first = flags.indexOf(true);
    const last = flags.lastIndexOf(true);
    if (first < 0) {
      band = lower = upper = null;
      continue;
    }
    const entry: ContrastBand = {
      s,
      lo: first === 0 ? 0 : bisect(s, (first - 1) / samples, first / samples),
      hi:
        last === samples ? 1 : bisect(s, (last + 1) / samples, last / samples),
    };
    if (!band) {
      band = [];
      bands.push(band);
    }
    band.push(entry);

    if (entry.lo > 0) {
      if (!lower) {
        lower = [];
        lowerLines.push(lower);
      }
      lower.push({ s, v: entry.lo });
    } else {
      lower = null;
    }
    if (entry.hi < 1) {
      if (!upper) {
        upper = [];
        upperLines.push(upper);
      }
      upper.push({ s, v: entry.hi });
    } else {
      upper = null;
    }
  }
  return { bands, lines: [...lowerLines, ...upperLines] };
}
