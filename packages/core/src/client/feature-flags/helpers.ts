import type { ListFeatureFlagsResult } from "./types.js";

export type EvaluatedFeatureFlags =
  | Record<string, boolean>
  | { flags?: Record<string, boolean>; values?: Record<string, boolean> };

export function evaluatedFeatureFlagValues(
  result: EvaluatedFeatureFlags | undefined,
): Record<string, boolean> {
  if (!result) return {};
  const envelope = result as {
    flags?: unknown;
    values?: unknown;
  };
  if (
    envelope.flags &&
    typeof envelope.flags === "object" &&
    !Array.isArray(envelope.flags)
  ) {
    return envelope.flags as Record<string, boolean>;
  }
  if (
    envelope.values &&
    typeof envelope.values === "object" &&
    !Array.isArray(envelope.values)
  ) {
    return envelope.values as Record<string, boolean>;
  }
  return result as Record<string, boolean>;
}

export function featureFlagValue(
  values: Record<string, boolean>,
  key: string,
): boolean {
  return values[key] === true;
}

export function hasManageableFeatureFlags(
  result: ListFeatureFlagsResult | undefined,
): result is ListFeatureFlagsResult & { canManage: true } {
  return Boolean(result?.canManage && result.flags.length);
}
