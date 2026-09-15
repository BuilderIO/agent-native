import { useLabState } from "@agent-native/core/client/labs";
import { CONTENT_CREATIVE_CONTEXT } from "@shared/labs";

export function useCreativeContextLab(): boolean {
  return useLabState(CONTENT_CREATIVE_CONTEXT.key).enabled;
}
