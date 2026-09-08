import {
  defineExperiment,
  defineExperiments,
} from "@agent-native/core/experiments/registry";

export const DESIGN_TWEAKS = defineExperiment({
  key: "design.tweaks",
  displayName: "Design tweaks",
  description:
    "Try AI-powered design tweaks. It is unstable and may have bugs.",
  keywords: "tweaks ai edit improve design",
});

export const DESIGN_EXPERIMENTS = defineExperiments([DESIGN_TWEAKS]);
