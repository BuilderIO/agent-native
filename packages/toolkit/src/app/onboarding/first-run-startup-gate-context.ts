import { createContext, useContext, type Context } from "react";

const FIRST_RUN_ONBOARDING_GATE_CONTEXT_KEY = Symbol.for(
  "agent-native.toolkit.firstRunOnboardingGateContext",
);
const firstRunOnboardingGateGlobal = globalThis as typeof globalThis & {
  [FIRST_RUN_ONBOARDING_GATE_CONTEXT_KEY]?: Context<boolean>;
};
export const FirstRunOnboardingGateContext = (firstRunOnboardingGateGlobal[
  FIRST_RUN_ONBOARDING_GATE_CONTEXT_KEY
] ??= createContext(false));

export function useFirstRunOnboardingGateOwnsSurface(): boolean {
  return useContext(FirstRunOnboardingGateContext);
}
