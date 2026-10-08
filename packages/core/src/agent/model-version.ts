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
    (provider === "builder"
      ? upgradeBuilderModelAlias(candidate, supportedModels)
      : undefined) ??
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
  const claudeLabel = getClaudeModelOptionLabel(model);
  if (claudeLabel !== model) return claudeLabel;

  const gpt = /^gpt-(\d+)(?:[.-](\d+))?(?:-(.+))?$/.exec(model);
  if (!gpt) return model;

  const version = gpt[2] ? `${gpt[1]}.${gpt[2]}` : gpt[1];
  const tierParts = gpt[3]?.split("-");
  if (tierParts?.some((part) => !part)) return model;
  const tier = tierParts?.length
    ? ` ${tierParts
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" ")}`
    : "";
  return `GPT-${version}${tier}`;
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
