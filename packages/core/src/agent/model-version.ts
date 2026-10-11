import {
  BUILDER_CLAUDE_SONNET_MODEL_ID,
  BUILDER_MODEL_ALIASES,
  BUILDER_MODEL_CONFIG,
  CLAUDE_SONNET_MODEL_ID,
  getClaudeModelOptionLabel,
} from "./model-config.js";

interface ParsedVersionedModelId {
  family: string;
  version: number[];
  suffix: string;
}

const UPGRADEABLE_GPT_TIERS = new Set(["-sol", "-terra", "-luna"]);
const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  "x-ai/grok-code-fast-1": "x-ai/grok-build-0.1",
};
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
  "anthropic/claude-opus-4.8": "Claude Opus 4.8",
  "anthropic/claude-opus-5.5": "Claude Opus 5.5",
  "anthropic/claude-sonnet-5.5": "Claude Sonnet 5.5",
  "deepseek/deepseek-chat-v3.1": "DeepSeek v3.1",
  "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "google/gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
  "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "google/gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
  "google/gemini-3.8-flash": "Gemini 3.8 Flash",
  "inception/mercury-2.5": "Mercury 2.5",
  "meta/muse-spark-1.3": "Muse Spark 1.3",
  "moonshotai/kimi-k2.5": "Kimi K2.5",
  "qwen/qwen3-coder": "Qwen3 Coder",
  "qwen/qwen3.8-max-0902": "Qwen 3.8 Max",
  "x-ai/grok-4.7": "Grok 4.7",
  "x-ai/grok-build-0.1": "Grok Build 0.1",
  "z-ai/glm-4.5": "GLM 4.5",
  "z-ai/glm-5.1": "GLM 5.1",
  "z-ai/glm-5.2": "GLM 5.2",
  "z-ai/glm-5.3-flash": "GLM 5.3 Flash",
};

export interface NormalizeModelOptions {
  preserveCustomModels?: boolean;
  acceptsCustomModels?: boolean;
}

export interface ModelEngineConfig {
  name: string;
  label?: string;
  defaultModel: string;
  supportedModels: readonly string[];
  /** Models currently offered in the picker, which may be a user-selected subset. */
  selectableModels?: readonly string[];
  acceptsCustomModels?: boolean;
  preserveCustomModels?: boolean;
}

function parseVersionedModelId(model: string): ParsedVersionedModelId | null {
  const match =
    /^(?<family>.+?)[-.](?<version>\d+(?:[-.]\d+)*)(?<suffix>(?:[-.][a-z][a-z0-9]*)*)$/i.exec(
      model.trim().toLowerCase(),
    );
  const groups = match?.groups;
  if (!groups?.family || !groups.version) return null;

  const version = groups.version.split(/[-.]/).map((part) => Number(part));
  if (version.some((part) => !Number.isSafeInteger(part))) return null;

  return {
    family: groups.family,
    version,
    suffix: groups.suffix ?? "",
  };
}

function compareModelVersions(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function findLatestSupportedVersionMatch(
  candidate: string,
  supportedModels: readonly string[],
): string | undefined {
  const parsedCandidate = parseVersionedModelId(candidate);
  if (!parsedCandidate) return undefined;

  let best: { model: string; version: number[] } | undefined;
  for (const supportedModel of supportedModels) {
    const parsedSupported = parseVersionedModelId(supportedModel);
    if (!parsedSupported) continue;
    if (parsedSupported.family !== parsedCandidate.family) continue;
    if (parsedSupported.suffix !== parsedCandidate.suffix) continue;
    if (
      best &&
      compareModelVersions(parsedSupported.version, best.version) <= 0
    ) {
      continue;
    }
    best = { model: supportedModel, version: parsedSupported.version };
  }

  return best?.model;
}

export function upgradeBuilderModelAlias(
  candidate: string,
  supportedModels: readonly string[],
): string | undefined {
  const latest = BUILDER_MODEL_ALIASES[candidate];
  return latest && supportedModels.includes(latest) ? latest : undefined;
}

function upgradeOpenRouterModelAlias(
  candidate: string,
  supportedModels: readonly string[],
  provider: string,
): string | undefined {
  if (provider !== "ai-sdk:openrouter") return undefined;
  const latest = OPENROUTER_MODEL_ALIASES[candidate];
  return latest && supportedModels.includes(latest) ? latest : undefined;
}

function upgradeProviderModelAlias(
  candidate: string,
  supportedModels: readonly string[],
  provider: string,
): string | undefined {
  return (
    (provider === "builder"
      ? upgradeBuilderModelAlias(candidate, supportedModels)
      : undefined) ??
    upgradeOpenRouterModelAlias(candidate, supportedModels, provider)
  );
}

export function isNewerVersionedModel(
  candidate: string,
  newerModel: string,
): boolean {
  const current = parseVersionedModelId(candidate);
  const newer = parseVersionedModelId(newerModel);
  return (
    current !== null &&
    newer !== null &&
    current.family === newer.family &&
    current.suffix === newer.suffix &&
    compareModelVersions(newer.version, current.version) > 0
  );
}

export function upgradeModelToLatestSupportedVersion(
  candidate: string,
  supportedModels: readonly string[],
): string | undefined {
  const parsedCandidate = parseVersionedModelId(candidate);
  if (
    !parsedCandidate ||
    (parsedCandidate.family !== "gpt" &&
      parsedCandidate.family !== "openai/gpt") ||
    !UPGRADEABLE_GPT_TIERS.has(parsedCandidate.suffix)
  ) {
    return undefined;
  }
  const latest = findLatestSupportedVersionMatch(candidate, supportedModels);
  return latest && isNewerVersionedModel(candidate, latest)
    ? latest
    : undefined;
}

export function upgradeModelForProvider(
  candidate: string,
  supportedModels: readonly string[],
  provider: string,
): string | undefined {
  return (
    upgradeProviderModelAlias(candidate, supportedModels, provider) ??
    upgradeModelToLatestSupportedVersion(candidate, supportedModels)
  );
}

export function normalizeModelForEngine(
  engine: ModelEngineConfig,
  model: string | null | undefined,
  options: NormalizeModelOptions = {},
): string {
  const candidate = typeof model === "string" ? model.trim() : "";
  if (!candidate) return engine.defaultModel;

  const providerAlias = upgradeProviderModelAlias(
    candidate,
    engine.supportedModels,
    engine.name,
  );
  if (providerAlias) return providerAlias;

  if (engine.preserveCustomModels || options.preserveCustomModels) {
    return candidate;
  }

  const upgradedModel = upgradeModelForProvider(
    candidate,
    engine.supportedModels,
    engine.name,
  );
  if (upgradedModel) return upgradedModel;

  if (
    candidate === "auto" ||
    engine.supportedModels.includes(candidate) ||
    engine.supportedModels.length === 0
  ) {
    return candidate;
  }

  if (engine.acceptsCustomModels || options.acceptsCustomModels) {
    return candidate === BUILDER_CLAUDE_SONNET_MODEL_ID &&
      engine.supportedModels.includes(CLAUDE_SONNET_MODEL_ID)
      ? CLAUDE_SONNET_MODEL_ID
      : candidate;
  }

  const versionMatch = findLatestSupportedVersionMatch(
    candidate,
    engine.supportedModels,
  );
  if (versionMatch && isNewerVersionedModel(candidate, versionMatch)) {
    return versionMatch;
  }

  if (versionMatch) return versionMatch;

  return engine.defaultModel;
}

function displayModelName(model: string): string {
  const knownLabel = Object.hasOwn(MODEL_DISPLAY_NAMES, model)
    ? MODEL_DISPLAY_NAMES[model]
    : undefined;
  if (knownLabel !== undefined) return knownLabel;

  const normalizedModel = model.replace(/^(?:anthropic|openai|google)\//, "");
  const claudeLabel = getClaudeModelOptionLabel(normalizedModel);
  if (claudeLabel !== normalizedModel) return claudeLabel;

  const gpt = /^gpt-(\d+)(?:[.-](\d+))?(?:-(.+))?$/.exec(normalizedModel);
  if (gpt) {
    const version = gpt[2] ? `${gpt[1]}.${gpt[2]}` : gpt[1];
    const tierParts = gpt[3]?.split("-");
    if (tierParts?.some((part) => !part)) return normalizedModel;
    const tier = tierParts?.length
      ? ` ${tierParts
          .map((part) => part[0].toUpperCase() + part.slice(1))
          .join(" ")}`
      : "";
    return `GPT-${version}${tier}`;
  }

  if (normalizedModel.startsWith("gemini-")) {
    return `Gemini ${normalizedModel
      .slice("gemini-".length)
      .replace(/-/g, " ")
      .replace(/\bflash\b/gi, "Flash")
      .replace(/\bpro\b/gi, "Pro")
      .replace(/\blite\b/gi, "Lite")}`;
  }

  if (normalizedModel.startsWith("grok-")) {
    return `Grok ${normalizedModel.slice("grok-".length).replace(/-/g, " ")}`;
  }

  if (normalizedModel.startsWith("deepseek-")) {
    return `DeepSeek ${normalizedModel
      .slice("deepseek-".length)
      .replace(/^v(\d)/i, "V$1")
      .replace(/-/g, " ")}`;
  }

  if (normalizedModel.startsWith("qwen")) {
    return normalizedModel.replace(/-/g, " ").replace(/^qwen/i, "Qwen");
  }

  if (normalizedModel.startsWith("glm-")) {
    return `GLM ${normalizedModel.slice("glm-".length).replace(/-/g, " ")}`;
  }

  if (normalizedModel.startsWith("kimi-")) {
    return `Kimi ${normalizedModel.slice("kimi-".length).replace(/-/g, " ")}`;
  }

  return normalizedModel;
}

export function getModelOptionLabel(
  model: string,
  engine?: ModelEngineConfig,
  builderFallbackLabel?: string,
): string {
  if (!engine) return displayModelName(model);

  const effectiveModel = normalizeModelForEngine(engine, model);
  const effectiveLabel = displayModelName(effectiveModel);
  if (effectiveModel === model) return effectiveLabel;
  const engineLabel =
    engine.name === "builder"
      ? builderFallbackLabel
      : (engine.label ?? engine.name);
  return engineLabel
    ? `${displayModelName(model)} → ${effectiveLabel} · ${engineLabel}`
    : `${displayModelName(model)} → ${effectiveLabel}`;
}

export function getBuilderModelOptionLabel(
  model: string,
  builderFallbackLabel?: string,
): string {
  return getModelOptionLabel(
    model,
    {
      name: "builder",
      label: "Builder",
      ...BUILDER_MODEL_CONFIG,
    },
    builderFallbackLabel,
  );
}
