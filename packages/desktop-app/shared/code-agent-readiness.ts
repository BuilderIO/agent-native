export function requiresConfiguredCodeAgentProvider(input: {
  providerConfigured: boolean;
  localCodeChange: boolean;
  executionTarget: "local" | "worktree" | "portal";
}): boolean {
  return (
    !input.providerConfigured &&
    !input.localCodeChange &&
    input.executionTarget !== "portal"
  );
}

export function isCodeAgentModelConfigured(
  models: ReadonlyArray<{
    engine: string;
    model: string;
    configured?: boolean;
  }>,
  selection: { engine?: string; model?: string },
): boolean {
  return models.some(
    (model) =>
      model.engine === selection.engine &&
      model.model === selection.model &&
      model.configured === true,
  );
}
