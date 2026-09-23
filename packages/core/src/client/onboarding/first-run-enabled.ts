import type {
  AgentNativeConfig,
  AgentNativeFirstRunOnboardingMode,
} from "../../config.js";
import { injectedAgentNativeConfig } from "../app-config.js";

const FIRST_RUN_ONBOARDING_ENV_KEY = "VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING";
type FirstRunOnboardingEnv = Record<string, string | boolean | undefined>;

function isEnabled(value: string | boolean | undefined): boolean {
  return (
    value === true ||
    (typeof value === "string" &&
      ["1", "true"].includes(value.trim().toLowerCase()))
  );
}

export function isFirstRunOnboardingEnabled(
  env: FirstRunOnboardingEnv = (import.meta.env ?? {}) as FirstRunOnboardingEnv,
  config: AgentNativeConfig = injectedAgentNativeConfig(),
): boolean {
  return resolveFirstRunOnboardingMode(env, config) !== "off";
}

export function resolveFirstRunOnboardingMode(
  env: FirstRunOnboardingEnv = (import.meta.env ?? {}) as FirstRunOnboardingEnv,
  config: AgentNativeConfig = injectedAgentNativeConfig(),
): AgentNativeFirstRunOnboardingMode {
  const envOnboarding = env[FIRST_RUN_ONBOARDING_ENV_KEY];
  if (envOnboarding !== undefined) {
    if (!isEnabled(envOnboarding)) return "off";
    return "connect";
  }

  const configured = config.onboarding?.firstRun;
  if (configured === "connect" || configured === "connect-and-integrations") {
    return configured;
  }
  return "off";
}
