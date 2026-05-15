export interface DreamSettings {
  enabled: boolean;
  schedule: string;
  sourceId: string;
  sourceIds?: string[];
  allSources: boolean;
  query?: string | null;
  limit: number;
  sourceTimeoutMs: number;
  sourceConcurrency?: number;
  sourceStartStaggerMs?: number;
  threadConcurrency?: number;
  threadTimeoutMs?: number;
  minCandidateCount: number;
}

export interface DreamSettingsDraft {
  enabled: boolean;
  schedule: string;
  sourceId: string;
  sourceIdsText: string;
  allSources: boolean;
  query: string;
  limit: string;
  sourceTimeoutMs: string;
  sourceConcurrency: string;
  sourceStartStaggerMs: string;
  threadConcurrency: string;
  threadTimeoutMs: string;
  minCandidateCount: string;
}

export function dreamSettingsToDraft(
  settings: DreamSettings | null | undefined,
): DreamSettingsDraft {
  return {
    enabled: settings?.enabled ?? false,
    schedule: settings?.schedule ?? "0 9 * * 1",
    sourceId: settings?.sourceId ?? "all",
    sourceIdsText: (settings?.sourceIds ?? []).join("\n"),
    allSources: settings?.allSources ?? true,
    query: settings?.query ?? "",
    limit: String(settings?.limit ?? 8),
    sourceTimeoutMs: String(settings?.sourceTimeoutMs ?? 30_000),
    sourceConcurrency: String(settings?.sourceConcurrency ?? 2),
    sourceStartStaggerMs: String(settings?.sourceStartStaggerMs ?? 250),
    threadConcurrency: String(settings?.threadConcurrency ?? 3),
    threadTimeoutMs: String(settings?.threadTimeoutMs ?? 8_000),
    minCandidateCount: String(settings?.minCandidateCount ?? 1),
  };
}

export function splitSourceIds(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function dreamSettingsUpdateFromDraft(
  draft: DreamSettingsDraft,
): Partial<DreamSettings> {
  const sourceIds = splitSourceIds(draft.sourceIdsText);
  const update: Partial<DreamSettings> = {
    enabled: draft.enabled,
    schedule: draft.schedule.trim(),
    sourceId: draft.sourceId.trim() || (draft.allSources ? "all" : "current"),
    sourceIds,
    allSources: draft.allSources,
    query: draft.query.trim(),
  };

  const limit = numberOrUndefined(draft.limit);
  if (limit !== undefined) update.limit = limit;
  const sourceTimeoutMs = numberOrUndefined(draft.sourceTimeoutMs);
  if (sourceTimeoutMs !== undefined) update.sourceTimeoutMs = sourceTimeoutMs;
  const sourceConcurrency = numberOrUndefined(draft.sourceConcurrency);
  if (sourceConcurrency !== undefined) {
    update.sourceConcurrency = sourceConcurrency;
  }
  const sourceStartStaggerMs = numberOrUndefined(draft.sourceStartStaggerMs);
  if (sourceStartStaggerMs !== undefined) {
    update.sourceStartStaggerMs = sourceStartStaggerMs;
  }
  const threadConcurrency = numberOrUndefined(draft.threadConcurrency);
  if (threadConcurrency !== undefined) {
    update.threadConcurrency = threadConcurrency;
  }
  const threadTimeoutMs = numberOrUndefined(draft.threadTimeoutMs);
  if (threadTimeoutMs !== undefined) update.threadTimeoutMs = threadTimeoutMs;
  const minCandidateCount = numberOrUndefined(draft.minCandidateCount);
  if (minCandidateCount !== undefined) {
    update.minCandidateCount = minCandidateCount;
  }
  return update;
}
