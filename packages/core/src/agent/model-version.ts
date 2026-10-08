import { BUILDER_MODEL_ALIASES } from "./model-config.js";

interface ParsedVersionedModelId {
  family: string;
  version: number[];
  suffix: string;
}

const UPGRADEABLE_GPT_TIERS = new Set(["-sol", "-terra", "-luna"]);

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
