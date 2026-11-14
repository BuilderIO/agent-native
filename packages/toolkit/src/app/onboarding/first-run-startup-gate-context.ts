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

// Shared across split/prebundled module copies, just like onboarding ownership.
const STARTUP_INTERACTION_CONTEXT_KEY = Symbol.for(
  "agent-native.toolkit.startupInteractionContext",
);
const startupInteractionGlobal = globalThis as typeof globalThis & {
  [STARTUP_INTERACTION_CONTEXT_KEY]?: Context<boolean>;
};
export const StartupInteractionContext = (startupInteractionGlobal[
  STARTUP_INTERACTION_CONTEXT_KEY
] ??= createContext(false));

export function useStartupInteractionBlocked(): boolean {
  return useContext(StartupInteractionContext);
}
