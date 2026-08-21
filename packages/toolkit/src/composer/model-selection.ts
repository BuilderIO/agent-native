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
