import { useLabState } from "@agent-native/core/client/labs";

export const T3_CODE_AGENTS_LAB = "t3-code-agents";

export function useT3AgentsLab(): boolean {
  return useLabState(T3_CODE_AGENTS_LAB).enabled;
}
