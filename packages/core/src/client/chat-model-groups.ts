export interface EngineModelGroup {
  engine: string;
  label: string;
  models: string[];
  configured: boolean;
}

export interface ChatModelEngineEntry {
  name: string;
  label: string;
  supportedModels?: readonly string[];
  requiredEnvVars?: readonly string[];
  packageInstalled?: boolean;
}

export interface BuildChatModelGroupsOptions {
  engines: readonly ChatModelEngineEntry[];
  configuredKeys?: Iterable<string>;
  builderConnected?: boolean;
  currentEngineName?: string;
  currentModel?: string;
}

const HIDDEN_CHAT_MODEL_ENGINES = new Set([
  "ai-sdk:groq",
  "ai-sdk:mistral",
  "ai-sdk:cohere",
]);

function addCurrentModel(
  models: readonly string[],
  engineName: string,
  currentEngineName?: string,
  currentModel?: string,
): string[] {
  const next = [...models];
  if (engineName === currentEngineName && currentModel && next.length === 0) {
    next.unshift(currentModel);
  }
  return next;
}

function groupBuilderModels(models: readonly string[]): EngineModelGroup[] {
  const claude = models.filter((model) => model.startsWith("claude-"));
  const openai = models.filter((model) => model.startsWith("gpt-"));
  const gemini = models.filter((model) => model.startsWith("gemini-"));
  const other = models.filter(
    (model) =>
      !model.startsWith("claude-") &&
      !model.startsWith("gpt-") &&
      !model.startsWith("gemini-"),
  );

  return [
    ...(claude.length
      ? [
          {
            engine: "builder",
            label: "Claude",
            models: claude,
            configured: true,
          },
        ]
      : []),
    ...(openai.length
      ? [
          {
            engine: "builder",
            label: "OpenAI",
            models: openai,
            configured: true,
          },
        ]
      : []),
    ...(gemini.length
      ? [
          {
            engine: "builder",
            label: "Gemini",
            models: gemini,
            configured: true,
          },
        ]
      : []),
    ...(other.length
      ? [
          {
            engine: "builder",
            label: "More",
            models: other,
            configured: true,
          },
        ]
      : []),
  ];
}

function shouldShowDirectEngine(
  engine: ChatModelEngineEntry,
  currentEngineName?: string,
): boolean {
  // Keep a persisted selection usable after an engine is hidden from the
  // picker; users can choose a supported replacement instead of landing on a
  // model that no longer has a rendered group.
  if (
    HIDDEN_CHAT_MODEL_ENGINES.has(engine.name) &&
    engine.name !== currentEngineName
  ) {
    return false;
  }
  if (engine.name === currentEngineName) return true;
  if (engine.name === "builder") return false;
  if (engine.name === "ai-sdk:anthropic") return false;
  if (engine.requiredEnvVars?.length === 0) return false;
  return true;
}

function putOpenRouterLast(
  a: ChatModelEngineEntry,
  b: ChatModelEngineEntry,
): number {
  const aIsOpenRouter = a.name === "ai-sdk:openrouter";
  const bIsOpenRouter = b.name === "ai-sdk:openrouter";
  if (aIsOpenRouter === bIsOpenRouter) return 0;
  if (aIsOpenRouter) return 1;
  if (bIsOpenRouter) return -1;
  return 0;
}

export function buildChatModelGroups({
  engines,
  configuredKeys,
  builderConnected = false,
  currentEngineName,
  currentModel,
}: BuildChatModelGroupsOptions): EngineModelGroup[] {
  const configured = new Set(configuredKeys ?? []);

  if (builderConnected) {
    const builderEngine = engines.find((engine) => engine.name === "builder");
    const builderModels = addCurrentModel(
      builderEngine?.supportedModels ?? [],
      "builder",
      currentEngineName,
      currentModel,
    );
    return groupBuilderModels(builderModels);
  }

  return engines
    .filter((engine) => engine.packageInstalled !== false)
    .filter((engine) => shouldShowDirectEngine(engine, currentEngineName))
    .sort(putOpenRouterLast)
    .map((engine) => {
      const requiredEnvVars = engine.requiredEnvVars ?? [];
      return {
        engine: engine.name,
        label: engine.label,
        models: addCurrentModel(
          engine.supportedModels ?? [],
          engine.name,
          currentEngineName,
          currentModel,
        ),
        configured:
          requiredEnvVars.length === 0 ||
          requiredEnvVars.some((key) => configured.has(key)),
      };
    })
    .filter((group) => group.models.length > 0);
}
