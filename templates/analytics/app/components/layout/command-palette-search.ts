export function commandPaletteKeywords(
  ...parts: Array<string | null | undefined>
): string[] {
  const variants = new Set<string>();

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    variants.add(trimmed);
    variants.add(trimmed.toLowerCase());
  };

  for (const part of parts) {
    if (!part) continue;

    add(part);

    const spaced = part.replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
    const hyphenated = spaced.trim().replace(/\s+/g, "-");
    const compact = spaced.trim().replace(/\s+/g, "");

    add(spaced);
    add(hyphenated);
    add(compact);
  }

  return Array.from(variants);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function fuzzySubsequenceScore(candidate: string, query: string): number {
  const compactCandidate = candidate.replace(/\s/g, "");
  const compactQuery = query.replace(/\s/g, "");
  let queryIndex = 0;

  for (const character of compactCandidate) {
    if (character === compactQuery[queryIndex]) queryIndex += 1;
    if (queryIndex === compactQuery.length) {
      return 0.2 * (compactQuery.length / compactCandidate.length);
    }
  }

  return 0;
}

export function commandPaletteFilter(
  value: string,
  search: string,
  keywords: string[] = [],
): number {
  const query = normalizeSearchText(search);
  if (!query) return 1;

  const queryWords = query.split(" ");
  let bestScore = 0;

  for (const rawCandidate of [...keywords, value]) {
    const candidate = normalizeSearchText(rawCandidate);
    if (!candidate) continue;

    const words = candidate.split(" ");
    let score = 0;

    if (candidate === query) score = 1;
    else if (candidate.startsWith(query)) score = 0.96;
    else if (words.includes(query)) score = 0.94;
    else if (words.some((word) => word.startsWith(query))) score = 0.9;
    else if (candidate.includes(query)) score = 0.8;
    else if (
      queryWords.every((queryWord) =>
        words.some((word) => word.startsWith(queryWord)),
      )
    ) {
      score = 0.72;
    } else {
      score = fuzzySubsequenceScore(candidate, query);
    }

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

export function rankCommandPaletteEntries<T>(
  entries: T[],
  search: string,
  getSearchData: (entry: T) => { value: string; keywords?: string[] },
): Array<{ entry: T; score: number }> {
  return entries
    .map((entry, index) => {
      const { value, keywords } = getSearchData(entry);
      return {
        entry,
        index,
        score: commandPaletteFilter(value, search, keywords),
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ entry, score }) => ({ entry, score }));
}

export function uniqueCommandItems<T extends { id: string; name: string }>(
  items: T[],
): T[] {
  const seenIds = new Set<string>();
  return items.filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });
}
