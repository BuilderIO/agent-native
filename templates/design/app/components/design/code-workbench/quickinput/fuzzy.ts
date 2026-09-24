/**
 * VS Code-ish fuzzy matcher for quick open / command palette rows.
 *
 * Pure and deterministic: same (query, target) always yields the same score
 * and match indices. Higher score = better match. Returns `null` when the
 * query's characters cannot be found in order within the target.
 */

export interface FuzzyMatch {
  score: number;
  matches: number[];
}

const CONSECUTIVE_BONUS = 15;
const WORD_BOUNDARY_BONUS = 30;
const CAMEL_CASE_BONUS = 25;
const PATH_BOUNDARY_BONUS = 40;
const FIRST_CHAR_BONUS = 20;
const EXACT_CASE_BONUS = 3;
const GAP_PENALTY = 2;
const LEADING_GAP_PENALTY = 1;

function isUpper(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase();
}

function isLower(char: string): boolean {
  return char !== char.toUpperCase() && char === char.toLowerCase();
}

function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9]/.test(char);
}

/**
 * Whether the character at `index` in `target` starts a "word": the very
 * first character, follows a path/word separator, follows a camelCase
 * transition, or follows a non-word character.
 */
function isBoundaryStart(
  target: string,
  index: number,
): "path" | "camel" | "word" | null {
  if (index === 0) return "word";
  const prev = target[index - 1]!;
  const current = target[index]!;
  if (prev === "/" || prev === "\\") return "path";
  if (prev === "-" || prev === "_" || prev === "." || prev === " ")
    return "word";
  if (isLower(prev) && isUpper(current)) return "camel";
  if (!isWordChar(prev) && isWordChar(current)) return "word";
  return null;
}

/**
 * Score a fuzzy match of `query` against `target`. Characters must appear in
 * `target` in the same order as `query` (case-insensitively), not necessarily
 * contiguous. Returns `null` when no valid match exists.
 *
 * Uses a greedy-with-lookback single pass: for each query character we pick
 * the earliest occurrence at or after the previous match position that keeps
 * the match valid, preferring boundary starts to maximize bonuses. This is a
 * simplified (non-DP) scorer — deterministic and fast, in the spirit of VS
 * Code's `fuzzyScore`.
 */
export function score(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, matches: [] };
  if (!target) return null;

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  const matches: number[] = [];
  let totalScore = 0;
  let targetIndex = 0;
  let previousMatchIndex = -1;
  let consecutiveRun = 0;

  for (let queryIndex = 0; queryIndex < queryLower.length; queryIndex += 1) {
    const queryChar = queryLower[queryIndex]!;
    const foundIndex = targetLower.indexOf(queryChar, targetIndex);
    if (foundIndex < 0) return null;

    const isConsecutive =
      previousMatchIndex >= 0 && foundIndex === previousMatchIndex + 1;
    const boundary = isBoundaryStart(target, foundIndex);

    let charScore = 1;
    if (isConsecutive) {
      consecutiveRun += 1;
      charScore += CONSECUTIVE_BONUS * consecutiveRun;
    } else {
      consecutiveRun = 0;
      if (previousMatchIndex >= 0) {
        const gap = foundIndex - previousMatchIndex - 1;
        charScore -= gap * GAP_PENALTY;
      } else if (foundIndex > 0) {
        charScore -= foundIndex * LEADING_GAP_PENALTY;
      }
    }

    if (foundIndex === 0) {
      charScore += FIRST_CHAR_BONUS;
    } else if (boundary === "path") {
      charScore += PATH_BOUNDARY_BONUS;
    } else if (boundary === "camel") {
      charScore += CAMEL_CASE_BONUS;
    } else if (boundary === "word") {
      charScore += WORD_BOUNDARY_BONUS;
    }

    if (target[foundIndex] === query[queryIndex]) {
      charScore += EXACT_CASE_BONUS;
    }

    totalScore += charScore;
    matches.push(foundIndex);
    previousMatchIndex = foundIndex;
    targetIndex = foundIndex + 1;
  }

  // Reward tighter overall matches (smaller span relative to target length).
  const span = matches[matches.length - 1]! - matches[0]! + 1;
  const compactnessBonus = Math.max(
    0,
    query.length * 2 - (span - query.length),
  );
  totalScore += compactnessBonus;

  return { score: totalScore, matches };
}

/**
 * Score a fuzzy match of `query` against a file path, weighting matches in
 * the basename above matches in the directory portion (VS Code quick-open
 * behavior: `foo` should rank `src/foo.ts` above `foo/bar.ts` equally on the
 * basename, but a basename hit always beats a pure directory hit).
 */
export function scoreFilePath(query: string, path: string): FuzzyMatch | null {
  if (!query) return { score: 0, matches: [] };

  const lastSlash = path.lastIndexOf("/");
  const basenameStart = lastSlash + 1;

  // First, try matching entirely (or mostly) within the basename — this is
  // the common case and should dominate ranking.
  const fullMatch = score(query, path);
  if (!fullMatch) return null;

  const matchesInBasename = fullMatch.matches.filter(
    (index) => index >= basenameStart,
  ).length;
  const matchesInDir = fullMatch.matches.length - matchesInBasename;

  // Bonus proportional to how much of the query matched inside the basename,
  // and a penalty for characters that only matched in the directory portion.
  const basenameBonus = matchesInBasename * 35;
  const dirPenalty = matchesInDir * 10;

  // Extra bonus if the match run that reaches the end of the string starts
  // at or after the basename boundary (i.e. the tail of the query lands in
  // the filename, not the directory).
  const lastMatchIndex = fullMatch.matches[fullMatch.matches.length - 1] ?? -1;
  const endsInBasename = lastMatchIndex >= basenameStart ? 20 : 0;

  return {
    score: fullMatch.score + basenameBonus - dirPenalty + endsInBasename,
    matches: fullMatch.matches,
  };
}
