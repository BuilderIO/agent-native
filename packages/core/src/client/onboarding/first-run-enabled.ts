import type {
  AgentNativeConfig,
  AgentNativeFirstRunOnboardingMode,
} from "../../config.js";
import {
  FIRST_RUN_ONBOARDING_ENV_OVERRIDE_KEY,
  isFirstRunOnboardingModeActive,
  resolveEffectiveFirstRunOnboardingMode,
} from "../../config.js";
import { injectedAgentNativeConfig } from "../app-config.js";

type FirstRunOnboardingEnv = Record<string, string | boolean | undefined>;

export function isFirstRunOnboardingEnabled(
  env: FirstRunOnboardingEnv = (import.meta.env ?? {}) as FirstRunOnboardingEnv,
  config: AgentNativeConfig = injectedAgentNativeConfig(),
): boolean {
  return isFirstRunOnboardingModeActive(
    resolveFirstRunOnboardingMode(env, config),
  );
}

export function resolveFirstRunOnboardingMode(
  env: FirstRunOnboardingEnv = (import.meta.env ?? {}) as FirstRunOnboardingEnv,
  config: AgentNativeConfig = injectedAgentNativeConfig(),
): AgentNativeFirstRunOnboardingMode {
  return resolveEffectiveFirstRunOnboardingMode(
    env[FIRST_RUN_ONBOARDING_ENV_OVERRIDE_KEY],
    config.onboarding?.firstRun as
      | AgentNativeFirstRunOnboardingMode
      | undefined,
  );
}
