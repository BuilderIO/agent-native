
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

  const span = matches[matches.length - 1]! - matches[0]! + 1;
  const compactnessBonus = Math.max(
    0,
    query.length * 2 - (span - query.length),
  );
  totalScore += compactnessBonus;

  return { score: totalScore, matches };
}

export function scoreFilePath(query: string, path: string): FuzzyMatch | null {
  if (!query) return { score: 0, matches: [] };

  const lastSlash = path.lastIndexOf("/");
  const basenameStart = lastSlash + 1;

  const fullMatch = score(query, path);
  if (!fullMatch) return null;

  const matchesInBasename = fullMatch.matches.filter(
    (index) => index >= basenameStart,
  ).length;
  const matchesInDir = fullMatch.matches.length - matchesInBasename;

  const basenameBonus = matchesInBasename * 35;
  const dirPenalty = matchesInDir * 10;

  const lastMatchIndex = fullMatch.matches[fullMatch.matches.length - 1] ?? -1;
  const endsInBasename = lastMatchIndex >= basenameStart ? 20 : 0;

  return {
    score: fullMatch.score + basenameBonus - dirPenalty + endsInBasename,
    matches: fullMatch.matches,
  };
}
