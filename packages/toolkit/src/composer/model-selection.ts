export interface ComposerModelGroupLike {
  engine: string;
  models: readonly string[];
  configured?: boolean;
}

export function isClaudeCodeAgentId(agentId: string | undefined): boolean {
  return agentId === "claude-code" || agentId === "claude-cli";
}

export function isLunaModel(model: string): boolean {
  return model.toLowerCase().includes("luna");
}

export function isClaudeModelId(model: string): boolean {
  return model.toLowerCase().startsWith("claude-");
}

export function filterModelGroupsForAgent<T extends ComposerModelGroupLike>(
  agentId: string | undefined,
  groups: readonly T[],
): T[] {
  if (!isClaudeCodeAgentId(agentId)) return [...groups];
  return groups
    .filter((group) => group.engine === "claude-cli")
    .map((group) => ({
      ...group,
      models: group.models.filter(isClaudeModelId),
    }))
    .filter((group) => group.models.length > 0);
}

export function resolvePreferredAgentModel(
  agentId: string | undefined,
  groups: readonly ComposerModelGroupLike[],
): { model: string; engine: string } | undefined {
  const candidates = groups.flatMap((group) =>
    group.models
      .filter((model) => model !== "auto")
      .map((model) => ({
        model,
        engine: group.engine,
        configured: group.configured !== false,
      })),
  );
  const orderedCandidates = [
    ...candidates.filter((candidate) => candidate.configured),
    ...candidates.filter((candidate) => !candidate.configured),
  ];

  if (isClaudeCodeAgentId(agentId)) {
    const preferred =
      orderedCandidates.find(
        (candidate) =>
          candidate.model.toLowerCase().includes("sonnet") &&
          !isLunaModel(candidate.model),
      ) ?? orderedCandidates.find((candidate) => !isLunaModel(candidate.model));
    return preferred
      ? { model: preferred.model, engine: preferred.engine }
      : undefined;
  }

  const preferred = orderedCandidates.find((candidate) =>
    isLunaModel(candidate.model),
  );
  return preferred
    ? { model: preferred.model, engine: preferred.engine }
    : undefined;
}

/** The picker's short list, Auto aside. */
export const MAIN_MODEL_ROW_LIMIT = 4;

export interface CuratableModelRow {
  /** Dedupe key: one model offered by two engines is one short-list row. */
  identity: string;
  recommendedRank?: number | undefined;
  /** Position in the catalog's fixed root list. */
  rootRank?: number | undefined;
  provider?: string | undefined;
}

/** The rows that carry a rank, in rank order, keeping the first per identity. */
function rankedRows<T extends CuratableModelRow>(
  rows: readonly T[],
  rankOf: (row: T) => number | undefined,
): T[] {
  const seen = new Set<string>();
  return rows
    .flatMap((row) => {
      const rank = rankOf(row);
      return rank === undefined ? [] : [{ row, rank }];
    })
    .sort((a, b) => a.rank - b.rank)
    .flatMap(({ row }) => {
      if (seen.has(row.identity)) return [];
      seen.add(row.identity);
      return [row];
    });
}

/**
 * Split available rows into the short list and More models. The catalog's
 * root list wins: whichever of its models the engines offer, in its order.
 * With none of those, up to four recommended models, one per provider first
 * (so a single key shows that provider's ladder), then by rank. An engine
 * offering four or fewer models shows them all and has no More models. Rows
 * are only ever moved between the lists, never added or dropped.
 */
export function curateModelPickerRows<T extends CuratableModelRow>(
  rows: readonly T[],
  limit = MAIN_MODEL_ROW_LIMIT,
): { main: T[]; more: T[] } {
  if (rows.length <= limit) return { main: [...rows], more: [] };
  const root = rankedRows(rows, (row) => row.rootRank);
  if (root.length > 0) {
    return { main: root, more: rows.filter((row) => !root.includes(row)) };
  }
  const ranked = rankedRows(rows, (row) => row.recommendedRank);
  const picked: T[] = [];
  const providers = new Set<string>();
  for (const row of ranked) {
    if (picked.length >= limit) break;
    const provider = row.provider ?? row.identity;
    if (providers.has(provider)) continue;
    providers.add(provider);
    picked.push(row);
  }
  for (const row of ranked) {
    if (picked.length >= limit) break;
    if (!picked.includes(row)) picked.push(row);
  }
  const main = picked.length > 0 ? picked : rows.slice(0, limit);
  main.sort(
    (a, b) =>
      (a.recommendedRank ?? Number.POSITIVE_INFINITY) -
      (b.recommendedRank ?? Number.POSITIVE_INFINITY),
  );
  return { main, more: rows.filter((row) => !main.includes(row)) };
}
