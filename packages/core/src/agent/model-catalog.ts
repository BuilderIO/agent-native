import {
  getReasoningEffortOptionsForModel,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "./chatgpt-subscription-contract.js";
import {
  BUILDER_MODEL_CONFIG,
  getKnownContextWindowForModel,
} from "./model-config.js";

export type ModelRating = 1 | 2 | 3 | 4 | 5;

export interface ModelRatings {
  cost: ModelRating;
  reasoning: ModelRating;
  speed: ModelRating;
}

export const MODEL_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "qwen",
  "moonshot",
  "deepseek",
  "zai",
  "meta",
  "inception",
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export interface ModelCatalogEntry {
  /** Canonical id: what `canonicalModelId` returns for every engine's id. */
  id: string;
  name: string;
  /** Picker row name, without the family prefix ("Opus 5.5"). Defaults to `name`. */
  shortName?: string;
  /** Two or three muted words under the row name. Absent when we don't know. */
  descriptor?: ModelDescriptorId;
  /** One neutral line for the hover card. Absent when we don't know. */
  description?: string;
  provider?: ModelProvider;
  ratings?: ModelRatings;
  /**
   * Eligible for the picker's short list. Recommended entries are ranked by
   * their order in `MODEL_CATALOG`.
   */
  recommended?: boolean;
  /**
   * The level the provider applies when a request names none, from the
   * provider's documentation. Absent where the docs state no default.
   */
  providerDefaultEffort?: ReasoningEffort;
  /** Engine ids that canonicalization alone does not map onto `id`. */
  aliases?: readonly string[];
}

/**
 * Ratings place a model on its own provider's published ladder (entry, mid,
 * flagship, small), mapped onto one 1-5 scale:
 *
 *   small    cost 1  reasoning 2  speed 5   (mini, flash-lite)
 *   entry    cost 1  reasoning 3  speed 5   (Haiku, Luna, Flash)
 *   mid      cost 3  reasoning 4  speed 4   (Sonnet, Terra)
 *   flagship cost 5  reasoning 5  speed 2   (Opus, Sol, Pro)
 *
 * They are not cross-provider benchmarks or prices. A model whose place on
 * its ladder we can't state from the provider's own positioning (older
 * generations, Fable, third-party open models) has no ratings, and one we
 * can't describe has no description: the picker then shows its name only.
 */
const SMALL: ModelRatings = { cost: 1, reasoning: 2, speed: 5 };
const ENTRY: ModelRatings = { cost: 1, reasoning: 3, speed: 5 };
const MID: ModelRatings = { cost: 3, reasoning: 4, speed: 4 };
const FLAGSHIP: ModelRatings = { cost: 5, reasoning: 5, speed: 2 };

/** Row descriptors, shared across models so each is translated once. */
export const MODEL_DESCRIPTORS = {
  recommended: "Recommended",
  flagship: "Flagship capability",
  balanced: "Balanced, efficient",
  fastLightweight: "Fast, lightweight",
  fastLowerCost: "Fast, lower cost",
  previousGeneration: "Previous generation",
  smallLowCost: "Small, low cost",
  smallCoding: "Small, for coding",
  lowestCost: "Lowest cost",
  fastCoding: "Fast, for coding",
  openWeightCoding: "Open-weight coding",
} as const;

export type ModelDescriptorId = keyof typeof MODEL_DESCRIPTORS;

/** Order is the picker's order, and the rank among recommended entries. */
export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: "auto",
    name: "Auto",
    descriptor: "recommended",
    description: "Uses the default model",
    recommended: true,
  },
  {
    id: "claude-opus-5-5",
    providerDefaultEffort: "medium",
    name: "Claude Opus 5.5",
    shortName: "Opus 5.5",
    descriptor: "flagship",
    description: "Most capable Claude model for complex work",
    provider: "anthropic",
    ratings: FLAGSHIP,
    recommended: true,
  },
  {
    id: "gpt-6-1-sol",
    name: "GPT-6.1 Sol",
    descriptor: "flagship",
    description: "Most capable GPT model for complex reasoning",
    provider: "openai",
    ratings: FLAGSHIP,
    recommended: true,
  },
  {
    id: "gemini-3-1-pro",
    name: "Gemini 3.1 Pro",
    descriptor: "flagship",
    description: "Most capable Gemini model for complex work",
    provider: "google",
    ratings: FLAGSHIP,
    recommended: true,
  },
  {
    id: "claude-sonnet-5-5",
    providerDefaultEffort: "high",
    name: "Claude Sonnet 5.5",
    shortName: "Sonnet 5.5",
    descriptor: "balanced",
    description: "Balanced speed and capability for everyday work",
    provider: "anthropic",
    ratings: MID,
    recommended: true,
  },
  {
    id: "gpt-5-6-terra",
    name: "GPT-5.6 Terra",
    descriptor: "balanced",
    description: "Mid-range GPT model balancing cost and capability",
    provider: "openai",
    ratings: MID,
    recommended: true,
  },
  {
    id: "claude-haiku-5-5",
    providerDefaultEffort: "medium",
    name: "Claude Haiku 5.5",
    shortName: "Haiku 5.5",
    descriptor: "fastLightweight",
    description: "Fastest Claude model for quick tasks",
    provider: "anthropic",
    ratings: ENTRY,
    recommended: true,
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    descriptor: "fastLowerCost",
    description: "Fast, lower-cost GPT model for everyday tasks",
    provider: "openai",
    ratings: ENTRY,
    recommended: true,
  },
  {
    id: "gemini-3-8-flash",
    name: "Gemini 3.8 Flash",
    descriptor: "fastLightweight",
    description: "Fast Gemini model for everyday tasks",
    provider: "google",
    ratings: ENTRY,
    recommended: true,
  },
  {
    id: "claude-opus-4-8",
    providerDefaultEffort: "high",
    name: "Claude Opus 4.8",
    shortName: "Opus 4.8",
    descriptor: "previousGeneration",
    provider: "anthropic",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    shortName: "Haiku 4.5",
    descriptor: "previousGeneration",
    provider: "anthropic",
  },
  {
    id: "claude-fable-5-1",
    providerDefaultEffort: "high",
    name: "Claude Fable 5.1",
    shortName: "Fable 5.1",
    provider: "anthropic",
  },
  {
    id: "claude-fable-5",
    providerDefaultEffort: "high",
    name: "Claude Fable 5",
    shortName: "Fable 5",
    provider: "anthropic",
  },
  {
    id: "gpt-5-5",
    name: "GPT-5.5",
    descriptor: "previousGeneration",
    provider: "openai",
  },
  {
    id: "gpt-5-4",
    name: "GPT-5.4",
    descriptor: "previousGeneration",
    provider: "openai",
  },
  {
    id: "gpt-5-4-mini",
    name: "GPT-5.4 Mini",
    descriptor: "smallLowCost",
    description: "Small, low-cost GPT model",
    provider: "openai",
    ratings: SMALL,
  },
  {
    id: "gpt-5-1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    descriptor: "smallCoding",
    description: "Small GPT model tuned for coding",
    provider: "openai",
    ratings: SMALL,
  },
  { id: "gpt-6-astra", name: "GPT-6 Astra", provider: "openai" },
  { id: "gpt-6-astra-pro", name: "GPT-6 Astra Pro", provider: "openai" },
  {
    id: "gemini-3-5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    descriptor: "lowestCost",
    description: "Lowest-cost Gemini model for simple, high-volume tasks",
    provider: "google",
    ratings: SMALL,
  },
  {
    id: "gemini-3-1-flash-lite",
    name: "Gemini 3.1 Flash-Lite",
    descriptor: "previousGeneration",
    provider: "google",
  },
  {
    id: "grok-code-fast",
    name: "Grok Code Fast",
    descriptor: "fastCoding",
    description: "Fast coding model from xAI",
    provider: "xai",
  },
  { id: "grok-4-7", name: "Grok 4.7", provider: "xai" },
  { id: "grok-build-0-1", name: "Grok Build 0.1", provider: "xai" },
  {
    id: "qwen3-coder",
    name: "Qwen3 Coder",
    descriptor: "openWeightCoding",
    description: "Open-weight coding model from Qwen",
    provider: "qwen",
  },
  { id: "qwen3-8-max-0902", name: "Qwen 3.8 Max", provider: "qwen" },
  { id: "kimi-k2-5", name: "Kimi K2.5", provider: "moonshot" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek" },
  {
    id: "deepseek-v4-1-flash",
    name: "DeepSeek V4.1 Flash",
    provider: "deepseek",
  },
  {
    id: "deepseek-v3-1",
    name: "DeepSeek V3.1",
    provider: "deepseek",
    aliases: ["deepseek-chat-v3-1"],
  },
  {
    id: "glm-4-5",
    name: "GLM 4.5",
    provider: "zai",
    aliases: ["z-ai-glm-4-5"],
  },
  {
    id: "glm-5-1",
    name: "GLM 5.1",
    provider: "zai",
    aliases: ["z-ai-glm-5-1"],
  },
  { id: "glm-5-2", name: "GLM 5.2", provider: "zai" },
  {
    id: "glm-5-3-flash",
    name: "GLM 5.3 Flash",
    provider: "zai",
    aliases: ["z-ai-glm-5-3-flash"],
  },
  { id: "muse-spark-1-3", name: "Muse Spark 1.3", provider: "meta" },
  { id: "mercury-2-5", name: "Mercury 2.5", provider: "inception" },
];

/**
 * One key for every engine's spelling of a model: OpenRouter's
 * `anthropic/claude-opus-5.5`, Anthropic's `claude-opus-5-5`, a dated
 * `claude-haiku-4-5-20251001`, and Gemini's `-preview` ids all collapse to the
 * dashed, unprefixed id the Builder gateway uses. It names the model; it does
 * not upgrade one version to another (that is `model-version`'s job).
 */
export function canonicalModelId(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/^[^/]+\//, "")
    .replace(/-\d{8,}$/, "")
    .replace(/-preview$/, "")
    .replace(/\./g, "-");
}

const CATALOG_BY_KEY: ReadonlyMap<string, ModelCatalogEntry> = new Map(
  MODEL_CATALOG.flatMap((entry) => [
    [entry.id, entry] as const,
    ...(entry.aliases ?? []).map((alias) => [alias, entry] as const),
  ]),
);

/**
 * The picker's root list after Auto, in order; everything else is under More
 * models. A model the engine doesn't offer is skipped, and an engine offering
 * none of these falls back to its own recommended ladder.
 */
export const PICKER_ROOT_MODEL_IDS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "gpt-6-1-sol",
  "gpt-6-luna",
] as const;

const PICKER_ROOT_RANK: ReadonlyMap<string, number> = new Map(
  PICKER_ROOT_MODEL_IDS.map((id, index) => [id, index] as const),
);

const RECOMMENDED_RANK: ReadonlyMap<string, number> = new Map(
  MODEL_CATALOG.filter((entry) => entry.recommended).map(
    (entry, index) => [entry.id, index] as const,
  ),
);

/** The catalog entry for any engine's id, or undefined for an unknown model. */
export function findModelCatalogEntry(
  modelId: string | undefined,
): ModelCatalogEntry | undefined {
  if (!modelId) return undefined;
  return CATALOG_BY_KEY.get(canonicalModelId(modelId));
}

/** How the active engine pays for a request; a property of the engine, not the model. */
export type EngineBilling =
  | { kind: "builder-credits" }
  | { kind: "provider-key"; provider: string }
  | { kind: "subscription"; plan: string };

const PROVIDER_KEY_ENGINES: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  "ai-sdk:anthropic": "Anthropic",
  "ai-sdk:openai": "OpenAI",
  "ai-sdk:openrouter": "OpenRouter",
  "ai-sdk:google": "Google",
  "ai-sdk:groq": "Groq",
  "ai-sdk:mistral": "Mistral",
  "ai-sdk:cohere": "Cohere",
};

/**
 * Undefined for engines with no billing we can state: local runtimes (Ollama,
 * Codex, Claude Code sign-ins) and custom registered engines.
 */
export function getEngineBilling(
  engine: string | undefined,
): EngineBilling | undefined {
  if (!engine) return undefined;
  if (engine === "builder") return { kind: "builder-credits" };
  if (engine === CHATGPT_SUBSCRIPTION_ENGINE_NAME) {
    return { kind: "subscription", plan: "ChatGPT" };
  }
  const provider = Object.hasOwn(PROVIDER_KEY_ENGINES, engine)
    ? PROVIDER_KEY_ENGINES[engine]
    : undefined;
  return provider ? { kind: "provider-key", provider } : undefined;
}

/**
 * Engines that drop `reasoningEffort` on the way to the provider. The AI SDK
 * engine maps effort into provider options only for Anthropic, OpenAI,
 * OpenRouter, and Google; the rest ignore it, so offering a level there would
 * be a control that does nothing. Engines not listed (Builder, Anthropic,
 * ChatGPT plan, local runtimes, custom engines) pass the model's levels on.
 */
const ENGINES_WITHOUT_EFFORT: ReadonlySet<string> = new Set([
  "ai-sdk:groq",
  "ai-sdk:mistral",
  "ai-sdk:cohere",
  "ai-sdk:ollama",
]);

/** The model each engine runs for `auto`, when the engine resolves it itself. */
const AUTO_MODEL_BY_ENGINE: ReadonlyMap<string, string> = new Map([
  ["builder", BUILDER_MODEL_CONFIG.defaultModel],
]);

export interface ModelDescription {
  /** The id the engine was asked about, unchanged. */
  modelId: string;
  engine?: string;
  /** False for custom ids and plan models with no catalog entry. */
  known: boolean;
  /** The catalog entry's id, for copy keyed by model. */
  catalogId?: string;
  name?: string;
  shortName?: string;
  descriptorId?: ModelDescriptorId;
  descriptor?: string;
  description?: string;
  provider?: ModelProvider;
  ratings?: ModelRatings;
  recommended: boolean;
  /** Position among recommended models; undefined for the rest. */
  recommendedRank?: number;
  /** Position in the picker's root list; undefined for the rest. */
  rootRank?: number;
  /** The level the provider uses when no effort is sent; see the catalog. */
  providerDefaultEffort?: ReasoningEffort;
  /** Undefined when no table or family heuristic knows the window. */
  contextWindow?: number;
  /** The model's levels that the engine forwards; empty means no effort control. */
  efforts: ReasoningEffort[];
  billing?: EngineBilling;
  /** Whether efforts and the window came from the provider's model list. */
  source: "provider" | "catalog";
}

/** Facts a provider's model list reported, which win over the catalog. */
export interface LiveModelFacts {
  contextWindow?: number;
  /** Undefined when the provider did not report effort support. */
  efforts?: readonly ReasoningEffort[];
}

/**
 * Describe a model as one engine offers it. The catalog only enriches: it
 * never decides which models an engine lists, and an unknown model gets its
 * engine facts (efforts, billing, a known window) with nothing invented.
 */
export function describeModelForEngine(
  modelId: string,
  engine?: string,
  live?: LiveModelFacts,
): ModelDescription {
  const entry = findModelCatalogEntry(modelId);
  const resolvedModel =
    (modelId === "auto" && engine
      ? AUTO_MODEL_BY_ENGINE.get(engine)
      : undefined) ?? modelId;
  const efforts =
    engine && ENGINES_WITHOUT_EFFORT.has(engine)
      ? []
      : (live?.efforts ?? getReasoningEffortOptionsForModel(resolvedModel));
  const contextWindow =
    live?.contextWindow ??
    (resolvedModel === "auto"
      ? undefined
      : (getKnownContextWindowForModel(resolvedModel) ??
        (entry ? getKnownContextWindowForModel(entry.id) : undefined)));
  const billing = getEngineBilling(engine);
  const providerDefault = getProviderDefaultEffort(resolvedModel);
  const providerDefaultEffort =
    providerDefault && efforts.includes(providerDefault)
      ? providerDefault
      : undefined;
  const recommendedRank = entry?.recommended
    ? RECOMMENDED_RANK.get(entry.id)
    : undefined;
  const rootRank = entry ? PICKER_ROOT_RANK.get(entry.id) : undefined;
  return {
    modelId,
    ...(engine ? { engine } : {}),
    known: entry !== undefined,
    ...(entry
      ? { name: entry.name, shortName: entry.shortName ?? entry.name }
      : {}),
    ...(entry ? { catalogId: entry.id } : {}),
    ...(entry?.descriptor
      ? {
          descriptorId: entry.descriptor,
          descriptor: MODEL_DESCRIPTORS[entry.descriptor],
        }
      : {}),
    ...(entry?.description ? { description: entry.description } : {}),
    ...(entry?.provider ? { provider: entry.provider } : {}),
    ...(entry?.ratings ? { ratings: entry.ratings } : {}),
    recommended: entry?.recommended === true,
    ...(recommendedRank === undefined ? {} : { recommendedRank }),
    ...(rootRank === undefined ? {} : { rootRank }),
    ...(providerDefaultEffort ? { providerDefaultEffort } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    efforts: [...efforts],
    ...(billing ? { billing } : {}),
    source: live ? "provider" : "catalog",
  };
}

/**
 * The documented provider default for a model, or undefined when the
 * provider's docs state none. Used where a level must be named for a model
 * whose requests carry no effort, such as stepping effort down on a retry.
 */
export function getProviderDefaultEffort(
  modelId: string | undefined,
): ReasoningEffort | undefined {
  return findModelCatalogEntry(modelId)?.providerDefaultEffort;
}
