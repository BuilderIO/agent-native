import {
  defineExperiment,
  defineExperiments,
} from "@agent-native/core/experiments/registry";

export const CONTENT_CREATIVE_CONTEXT = defineExperiment({
  key: "content.creative-context",
  displayName: "Creative Context",
  description: "Connect and reuse governed reference context in Content.",
  keywords: "context creative library reference packs sources",
});

export const CONTENT_EXPERIMENTS = defineExperiments([
  CONTENT_CREATIVE_CONTEXT,
]);
