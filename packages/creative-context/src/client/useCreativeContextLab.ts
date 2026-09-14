import { useLabState } from "@agent-native/core/client/labs";

import { CREATIVE_CONTEXT_LIBRARY_LAB } from "../labs.js";

export function useCreativeContextLab(): boolean {
  return useLabState(CREATIVE_CONTEXT_LIBRARY_LAB.key).enabled;
}
