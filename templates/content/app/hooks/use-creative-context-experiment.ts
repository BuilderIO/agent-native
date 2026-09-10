import { useExperimentState } from "@agent-native/core/client/experiments";
import { CONTENT_CREATIVE_CONTEXT } from "@shared/experiments";

export function useCreativeContextExperiment(): boolean {
  return useExperimentState(CONTENT_CREATIVE_CONTEXT.key).enabled;
}
