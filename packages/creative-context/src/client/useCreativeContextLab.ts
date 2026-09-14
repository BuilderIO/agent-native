import { useLabState } from "@agent-native/core/client/labs";

import { CREATIVE_CONTEXT_LIBRARY_LAB } from "../labs.js";

export function useCreativeContextLabState() {
  return useLabState(CREATIVE_CONTEXT_LIBRARY_LAB.key);
}

export function useCreativeContextLab(): boolean {
  return useCreativeContextLabState().enabled;
}
