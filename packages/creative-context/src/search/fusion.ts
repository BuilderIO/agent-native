export interface RankedCandidate<T> {
  key: string;
  value: T;
  score: number;
  reason?: string;
}

export interface FusedCandidate<T> extends RankedCandidate<T> {
  laneRanks: Record<string, number>;
  reasons: string[];
}

export function reciprocalRankFusion<T>(
  lanes: Readonly<Record<string, readonly RankedCandidate<T>[]>>,
  options: { rankConstant?: number; limit?: number } = {},
): FusedCandidate<T>[] {
  const rankConstant = Math.max(1, options.rankConstant ?? 60);
  const fused = new Map<string, FusedCandidate<T>>();
  for (const [lane, candidates] of Object.entries(lanes)) {
    candidates.forEach((candidate, index) => {
      const rank = index + 1;
      const current = fused.get(candidate.key) ?? {
        ...candidate,
        score: 0,
        laneRanks: {},
        reasons: [],
      };
      current.score += 1 / (rankConstant + rank);
      current.laneRanks[lane] = rank;
      if (candidate.reason && !current.reasons.includes(candidate.reason)) {
        current.reasons.push(candidate.reason);
      }
      fused.set(candidate.key, current);
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, options.limit ?? 40));
}
