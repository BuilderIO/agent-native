import type { FeatureFlagDefinition } from "../feature-flags/registry.js";

export type ExperienceProfile = "reference" | "agent-native";

export interface ExperienceDeviation {
  flag: FeatureFlagDefinition;
  enabledInAgentNative: boolean;
}

export interface ExperienceProfileState {
  profile: ExperienceProfile;
  savedProfile: ExperienceProfile | null;
  referenceAvailable: boolean;
  values: Record<string, boolean>;
}

export function resolveExperienceFlags(
  deviations: readonly ExperienceDeviation[],
  profile: ExperienceProfile,
): Record<string, boolean> {
  const values: Record<string, boolean> = {};
  for (const { flag, enabledInAgentNative } of deviations) {
    if (Object.hasOwn(values, flag.key)) {
      throw new Error(`Duplicate experience deviation: ${flag.key}`);
    }
    values[flag.key] = profile === "agent-native" && enabledInAgentNative;
  }
  return values;
}
