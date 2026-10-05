import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "../agent/chatgpt-subscription-contract.js";

export interface EngineModelGroup {
  engine: string;
  label: string;
  models: string[];
  modelDisplayNames?: Readonly<Record<string, string>>;
  configured: boolean;
  isSubscription?: boolean;
}

export interface ChatModelEngineEntry {
  name: string;
  label: string;
  supportedModels?: readonly string[];
  modelDisplayNames?: Readonly<Record<string, string>>;
  acceptsCustomModels?: boolean;
  preserveCustomModels?: boolean;
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
  configuredError?: string;
  /**
   * Whether `supportedModels` is the provider's checked models (`selected`)
   * or its recommended list. A checked list is authoritative: the picker adds
   * nothing to it, and live discovery (Ollama) doesn't replace it.
   */
  modelSelection?: ChatModelSelectionState;
}

export interface ChatModelSelectionState {
  state: "default" | "selected" | "unreadable";
  scope?: "user" | "org";
  error?: string;
}

export interface BuildChatModelGroupsOptions {
  engines: readonly ChatModelEngineEntry[];
  configuredKeys?: Iterable<string>;
  builderConnected?: boolean;
  currentEngineName?: string;
  currentModel?: string;
}

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

/**
 * Live discovery replaces the static Ollama suggestions only while nobody has
 * checked models for it; the checked list already came from that discovery.
 */
export function usesLiveOllamaModels(
  engine: Pick<ChatModelEngineEntry, "name" | "modelSelection">,
): boolean {
  return (
    engine.name === "ai-sdk:ollama" &&
    engine.modelSelection?.state !== "selected"
  );
}

// Shown only once configured (or while they are the current engine).
const HIDDEN_CHAT_MODEL_ENGINES = new Set([
  "ai-sdk:groq",
  "ai-sdk:mistral",
  "ai-sdk:cohere",
]);

const HIDDEN_UNCONFIGURED_CHAT_MODEL_ENGINES = new Set([
  "ai-sdk:google",
  "ai-sdk:openrouter",
]);

function addCurrentModel(
  models: readonly string[],
  engineName: string,
  currentEngineName?: string,
  currentModel?: string,
  preserveCustomModels = false,
  acceptsCustomModels = false,
): string[] {
  const next = [...models];
  if (
    engineName === currentEngineName &&
    currentModel &&
    (next.length === 0 || preserveCustomModels || acceptsCustomModels) &&
    !next.includes(currentModel)
  ) {
    next.unshift(currentModel);
  }
  return next;
}

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

// Direct-key groups use the same family names ("OpenAI"), so the suffix is
// what separates Builder.io credits from a group billed to the user's own key.
const builderGroupLabel = (family: string) => `${family} · Builder.io`;

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
            label: builderGroupLabel("OpenAI"),
            models: openai,
            configured: true,
          },
        ]
      : []),
    ...(claude.length
      ? [
          {
            engine: "builder",
            label: builderGroupLabel("Claude"),
            models: claude,
            configured: true,
          },
        ]
      : []),
    ...(gemini.length
      ? [
          {
            engine: "builder",
            label: builderGroupLabel("Gemini"),
            models: gemini,
            configured: true,
          },
        ]
      : []),
    ...(other.length
      ? [
          {
            engine: "builder",
            label: builderGroupLabel("More"),
            models: other,
            configured: true,
          },
        ]
      : []),
  ];
}

function shouldShowDirectEngine(
  engine: ChatModelEngineEntry,
  configured: boolean,
  currentEngineName?: string,
): boolean {
  if (
    HIDDEN_CHAT_MODEL_ENGINES.has(engine.name) &&
    engine.name !== currentEngineName &&
    !configured
  ) {
    return false;
  }
  if (engine.name === currentEngineName) return true;
  if (engine.name === "builder") return false;
  if (engine.name === "ai-sdk:anthropic") return false;
  if (engine.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME) return configured;
  // Keyless engines (Ollama) always report ready, so only models someone
  // checked for them say they are set up.
  if (engine.requiredEnvVars?.length === 0) {
    return engine.modelSelection?.state === "selected";
  }
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

function shouldShowConfiguredGroup(group: EngineModelGroup): boolean {
  if (group.configured) return true;
  return !HIDDEN_UNCONFIGURED_CHAT_MODEL_ENGINES.has(group.engine);
}

export function buildChatModelGroups({
  engines,
  configuredKeys,
  builderConnected = false,
  currentEngineName,
  currentModel,
}: BuildChatModelGroupsOptions): EngineModelGroup[] {
  const configured = new Set(configuredKeys ?? []);
  // A checked list is the owner's choice; re-adding the current model would put
  // an unchecked model back in the picker.
  const modelsFor = (engine: ChatModelEngineEntry, customModels: boolean) =>
    engine.modelSelection?.state === "selected"
      ? [...(engine.supportedModels ?? [])]
      : addCurrentModel(
          engine.supportedModels ?? [],
          engine.name,
          currentEngineName,
          currentModel,
          customModels && engine.preserveCustomModels,
          customModels && engine.acceptsCustomModels,
        );
  const builderEngine = engines.find((engine) => engine.name === "builder");

  const directGroups = engines
    .filter((engine) => engine.packageInstalled !== false)
    .sort(sortModelPickerEngines)
    .map((engine) => {
      const requiredEnvVars = engine.requiredEnvVars ?? [];
      const group: EngineModelGroup = {
        engine: engine.name,
        label: engine.label,
        models:
          engine.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME
            ? modelsFor(engine, false)
            : sortModelsByCost(modelsFor(engine, true)),
        ...(engine.modelDisplayNames
          ? { modelDisplayNames: engine.modelDisplayNames }
          : {}),
        configured:
          engine.configured ??
          (requiredEnvVars.length === 0 ||
            requiredEnvVars.some((key) => configured.has(key))),
        ...(engine.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME
          ? { isSubscription: true }
          : {}),
      };
      return { engine, group };
    })
    .filter(({ engine, group }) =>
      shouldShowDirectEngine(engine, group.configured, currentEngineName),
    )
    .map(({ group }) => group)
    .filter((group) => group.models.length > 0)
    .filter(shouldShowConfiguredGroup);

  // A Builder.io connection, or the gateway lane (a Fusion preview or a
  // Builder-credits deploy, which bills the app's own Builder account and needs
  // no connect step). `/builder/status.configured` answers for the identity
  // lane only, so the gateway lane needs the catalog's server-resolved
  // readiness, which sees both.
  if (builderConnected || builderEngine?.configured === true) {
    // Providers with their own key stay selectable next to Builder.io, and a
    // pasted key also outranks the injected gateway at request time
    // (`selectDetectedEngine` skips deploy-injected sets). Unconfigured direct
    // engines are dropped: with a routable lane in the list they are dead ends,
    // not a setup path.
    return [
      ...(builderEngine
        ? groupBuilderModels(modelsFor(builderEngine, false))
        : []),
      ...directGroups.filter(
        (group) => group.configured && group.engine !== "builder",
      ),
    ];
  }

  return directGroups;
}
