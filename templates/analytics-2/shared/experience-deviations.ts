import type { ExperienceDeviation } from "@agent-native/core/experience-profiles";
import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";

// flip-or-kill: 2026-11-26
export const ANALYTICS_NATIVE_WORKSPACE = defineFeatureFlag({
  key: "analytics-2.native-workspace",
});

export const experienceDeviations: readonly ExperienceDeviation[] = [
  { flag: ANALYTICS_NATIVE_WORKSPACE, enabledInAgentNative: true },
];
