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
  /**
   * Server-resolved readiness. The env-key fallback below cannot see
   * vault-stored credentials or the deploy-injected Builder gateway lane, so
   * an engine running on either is reported unconfigured without this.
   *
   * Undefined means the server could not resolve it — including a credential
   * read that threw, reported in `configuredError`. That deliberately falls
   * through to the env heuristic rather than reading as "needs an API key".
   */
  configured?: boolean;
  /** Why readiness is unknown, when the server's lookup failed. */
  configuredError?: string;
}

export interface BuildChatModelGroupsOptions {
  engines: readonly ChatModelEngineEntry[];
  configuredKeys?: Iterable<string>;
  builderConnected?: boolean;
  currentEngineName?: string;
  currentModel?: string;
}

/**
 * A loaded provider-backed catalog can confirm that setup is missing before
 * the slower canonical readiness request resolves. An empty catalog is a
 * failed lookup, not evidence that no provider is configured.
 */
export function modelCatalogConfirmsMissing(
  groups: readonly Pick<EngineModelGroup, "configured">[] | undefined,
  loading: boolean | undefined,
): boolean {
  return (
    loading === false &&
    groups !== undefined &&
    groups.length > 0 &&
    groups.every((group) => !group.configured)
  );
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

// Cheapest → most expensive. The composer mirrors these tokens for the `$`
// cost labels on picker rows (packages/toolkit/src/composer/TiptapComposer.tsx);
// the toolkit cannot import core, so a new family must be added in both lists.
const MODEL_COST_ORDER = [
  "luna",
  "terra",
  "sol",
  "haiku",
  "sonnet",
  "opus",
  "fable",
  "flash",
  "pro",
] as const;

function modelCostRank(model: string): number {
  const normalized = model.toLowerCase();
  const rank = MODEL_COST_ORDER.findIndex((tier) => normalized.includes(tier));
  return rank === -1 ? MODEL_COST_ORDER.length : rank;
}

function sortModelsByCost(models: readonly string[]): string[] {
  return [...models].sort((a, b) => modelCostRank(a) - modelCostRank(b));
}

function groupBuilderModels(models: readonly string[]): EngineModelGroup[] {
  const claude = sortModelsByCost(
    models.filter((model) => model.startsWith("claude-")),
  );
  const openai = sortModelsByCost(
    models.filter((model) => model.startsWith("gpt-")),
  );
  const gemini = sortModelsByCost(
    models.filter((model) => model.startsWith("gemini-")),
  );
  const other = sortModelsByCost(
    models.filter(
      (model) =>
        !model.startsWith("claude-") &&
        !model.startsWith("gpt-") &&
        !model.startsWith("gemini-"),
    ),
  );

  return [
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

function modelPickerEngineRank(engine: ChatModelEngineEntry): number {
  if (engine.name === "ai-sdk:openai" || engine.label === "OpenAI") return 0;
  if (
    engine.name === "anthropic" ||
    engine.name === "ai-sdk:anthropic" ||
    engine.label === "Claude"
  ) {
    return 1;
  }
  if (engine.name === "ai-sdk:openrouter") return 100;
  return 2;
}

function sortModelPickerEngines(
  a: ChatModelEngineEntry,
  b: ChatModelEngineEntry,
): number {
  return modelPickerEngineRank(a) - modelPickerEngineRank(b);
}

export function buildChatModelGroups({
  engines,
  configuredKeys,
  builderConnected = false,
  currentEngineName,
  currentModel,
}: BuildChatModelGroupsOptions): EngineModelGroup[] {
  const configured = new Set(configuredKeys ?? []);
  const builderEngine = engines.find((engine) => engine.name === "builder");
  const builderModels = () =>
    addCurrentModel(
      builderEngine?.supportedModels ?? [],
      "builder",
      currentEngineName,
      currentModel,
    );

  if (builderConnected) {
    return groupBuilderModels(builderModels());
  }

  const directGroups = engines
    .filter((engine) => engine.packageInstalled !== false)
    .filter((engine) => shouldShowDirectEngine(engine, currentEngineName))
    .sort(sortModelPickerEngines)
    .map((engine) => {
      const requiredEnvVars = engine.requiredEnvVars ?? [];
      return {
        engine: engine.name,
        label: engine.label,
        models: sortModelsByCost(
          addCurrentModel(
            engine.supportedModels ?? [],
            engine.name,
            currentEngineName,
            currentModel,
          ),
        ),
        configured:
          engine.configured ??
          (requiredEnvVars.length === 0 ||
            requiredEnvVars.some((key) => configured.has(key))),
      };
    })
    .filter((group) => group.models.length > 0);

  // The gateway lane — a Fusion preview or a Builder-credits deploy — bills the
  // app's own Builder account and needs no connect step, but
  // `/builder/status.configured` answers for the IDENTITY lane only and is false
  // here. Without the catalog's server-resolved readiness (which sees both
  // lanes) every row in the picker is a dead "needs API key" while the gateway
  // is the one credential that can actually run the chat.
  if (builderEngine?.configured === true) {
    // A provider key the customer pasted still outranks the injected gateway at
    // request time (`selectDetectedEngine` skips deploy-injected sets), so it
    // stays selectable. Unconfigured direct engines are dropped: with a routable
    // lane in the list they are dead ends, not a setup path, and their labels
    // collide with the Builder families.
    return [
      ...groupBuilderModels(builderModels()),
      ...directGroups.filter(
        (group) => group.configured && group.engine !== "builder",
      ),
    ];
  }

  return directGroups;
}
