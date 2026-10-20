export type WorkspaceAppCandidateSource =
  | "workspace"
  | "org-directory"
  | "remote-agent"
  | "builtin";

export interface WorkspaceAppCandidate {
  id: string;
  name: string;
  description: string;
  whenToUse?: string[];
  aliases?: string[];
  source?: WorkspaceAppCandidateSource;
}

export interface WorkspaceAppSelection<T extends WorkspaceAppCandidate> {
  agents: T[];
  omittedCount: number;
  status: "selected" | "no-match";
  selectedIds: string[];
  explicitIds: string[];
  lexicalIds: string[];
  matchedIds: string[];
}

const SOURCE_PRIORITY: Record<WorkspaceAppCandidateSource, number> = {
  workspace: 0,
  "org-directory": 1,
  "remote-agent": 2,
  builtin: 3,
};

const LOW_SIGNAL_TOKENS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "to",
  "of",
  "this",
  "that",
  "me",
  "my",
  "please",
  "with",
  "from",
  "into",
  "on",
  "in",
  "at",
  "by",
  "is",
  "are",
  "be",
  "can",
  "could",
  "would",
  "do",
  "make",
  "get",
  "give",
  "create",
  "generate",
  "code",
  "app",
  "tool",
  "use",
  "using",
]);

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/\s+/u)
      .filter((token) => token && !LOW_SIGNAL_TOKENS.has(token)),
  );
}

function includesPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function compareCandidates<T extends WorkspaceAppCandidate>(
  left: T,
  right: T,
): number {
  const leftSource = SOURCE_PRIORITY[left.source ?? "builtin"];
  const rightSource = SOURCE_PRIORITY[right.source ?? "builtin"];
  return (
    leftSource - rightSource ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  );
}

function matchScore(
  candidate: WorkspaceAppCandidate,
  request: string,
): { explicitScore: number; lexicalScore: number } {
  const normalizedRequest = normalize(request);
  if (!normalizedRequest) return { explicitScore: 0, lexicalScore: 0 };

  const normalizedId = normalize(candidate.id);
  const normalizedName = normalize(candidate.name);
  let explicitScore = 0;
  if (
    (normalizedId && includesPhrase(normalizedRequest, normalizedId)) ||
    (normalizedName && includesPhrase(normalizedRequest, normalizedName))
  ) {
    explicitScore = 3_000;
  }

  const requestTokens = tokens(request);
  for (const alias of candidate.aliases ?? []) {
    const normalizedAlias = normalize(alias);
    if (normalizedAlias && includesPhrase(normalizedRequest, normalizedAlias)) {
      explicitScore = Math.max(explicitScore, 2_000);
    }
  }

  const fields = [
    candidate.name,
    candidate.description,
    ...(candidate.whenToUse ?? []),
  ];
  let lexicalScore = 0;
  for (const field of fields) {
    const normalizedField = normalize(field);
    if (normalizedField && includesPhrase(normalizedRequest, normalizedField))
      lexicalScore += 20;
    for (const token of tokens(field)) {
      if (requestTokens.has(token)) lexicalScore += 1;
    }
  }
  return { explicitScore, lexicalScore };
}

export function selectWorkspaceAppCandidates<T extends WorkspaceAppCandidate>(
  candidates: readonly T[],
  request: string,
  limit: number,
): WorkspaceAppSelection<T> {
  const hasRequest = normalize(request).length > 0;
  const scored = candidates.map((candidate) => ({
    candidate,
    ...matchScore(candidate, request),
  }));
  const hasMatches = scored.some(
    ({ explicitScore, lexicalScore }) => explicitScore > 0 || lexicalScore > 0,
  );
  const selected = scored
    .sort(
      (left, right) =>
        (hasRequest && hasMatches
          ? right.explicitScore - left.explicitScore ||
            right.lexicalScore - left.lexicalScore
          : 0) || compareCandidates(left.candidate, right.candidate),
    )
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(({ candidate }) => candidate);
  const compareMatched = (
    left: (typeof scored)[number],
    right: (typeof scored)[number],
  ) =>
    right.explicitScore - left.explicitScore ||
    right.lexicalScore - left.lexicalScore ||
    compareCandidates(left.candidate, right.candidate);
  const explicitIds = scored
    .filter(({ explicitScore }) => explicitScore > 0)
    .sort(compareMatched)
    .map(({ candidate }) => candidate.id);
  const lexicalIds = scored
    .filter(
      ({ explicitScore, lexicalScore }) =>
        explicitScore === 0 && lexicalScore > 0,
    )
    .sort(
      (left, right) =>
        right.lexicalScore - left.lexicalScore ||
        compareCandidates(left.candidate, right.candidate),
    )
    .map(({ candidate }) => candidate.id);
  const matchedIds = [...explicitIds, ...lexicalIds];

  return {
    agents: selected,
    omittedCount: candidates.length - selected.length,
    status: hasMatches ? "selected" : "no-match",
    selectedIds: selected.map(({ id }) => id),
    explicitIds,
    lexicalIds,
    matchedIds,
  };
}
