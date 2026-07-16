import type { FeatureFlagRules, ListFeatureFlagsResult } from "./types.js";

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

/**
 * Keep the shared editor safe while a remote app is upgrading or returning an
 * optimistic/transient rule envelope. The fleet contract still validates the
 * authoritative response; this only prevents absent collection fields from
 * crashing the operator UI between refreshes.
 */
export function normalizeFeatureFlagRules(
  rules: Partial<FeatureFlagRules> | null | undefined,
): FeatureFlagRules {
  const mode =
    rules?.mode === "off" || rules?.mode === "on" || rules?.mode === "rules"
      ? rules.mode
      : "rules";
  const percentage = Number.isFinite(rules?.percentage)
    ? Math.max(0, Math.min(100, Number(rules?.percentage)))
    : 0;

  return {
    ...rules,
    version: 1,
    mode,
    emails: Array.isArray(rules?.emails)
      ? rules.emails.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    orgIds: Array.isArray(rules?.orgIds)
      ? rules.orgIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    percentage,
  };
}
