import type { ShellRoute } from "./shell-contract";

// React Router's ranking, reduced to the segment kinds Content's routes use:
// a static segment beats a dynamic one, and a splat ranks below both.
const STATIC_SEGMENT_SCORE = 10;
const DYNAMIC_SEGMENT_SCORE = 3;
const SPLAT_SCORE = -2;

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function matchesShellPattern(
  pattern: string,
  pathname: string,
): boolean {
  const remaining = segments(pathname);
  for (const part of segments(pattern)) {
    if (part === "*") return true;
    const value = remaining.shift();
    if (value === undefined) return false;
    if (part.startsWith(":")) continue;
    if (part.toLowerCase() !== value.toLowerCase()) return false;
  }
  return remaining.length === 0;
}

function patternScore(pattern: string): number {
  return segments(pattern).reduce(
    (score, part) =>
      score +
      (part === "*"
        ? SPLAT_SCORE
        : part.startsWith(":")
          ? DYNAMIC_SEGMENT_SCORE
          : STATIC_SEGMENT_SCORE),
    0,
  );
}

export function matchShellRoute(
  pathname: string,
  routes: readonly ShellRoute[],
): ShellRoute | undefined {
  let best: ShellRoute | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const route of routes) {
    if (!matchesShellPattern(route.pattern, pathname)) continue;
    const score = patternScore(route.pattern);
    if (score > bestScore) {
      best = route;
      bestScore = score;
    }
  }
  return best;
}
