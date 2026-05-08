export const DEFAULT_GONG_CALL_LIMIT = 8;
export const MAX_GONG_CALL_LIMIT = 25;

export interface GongCallLike {
  id: string;
  started: string;
}

export function normalizeGongCallLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_GONG_CALL_LIMIT;
  return Math.max(1, Math.min(MAX_GONG_CALL_LIMIT, Math.floor(limit!)));
}

function startedMs(call: GongCallLike): number {
  const parsed = Date.parse(call.started);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst<T extends GongCallLike>(calls: T[]): T[] {
  return [...calls].sort((a, b) => startedMs(b) - startedMs(a));
}

export function limitGongCalls<T extends GongCallLike>(
  calls: T[],
  limit?: number,
): { calls: T[]; limit: number; truncated: boolean } {
  const normalizedLimit = normalizeGongCallLimit(limit);
  const sorted = newestFirst(calls);
  return {
    calls: sorted.slice(0, normalizedLimit),
    limit: normalizedLimit,
    truncated: sorted.length > normalizedLimit,
  };
}
