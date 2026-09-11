import type {
  AgentNativeConfig,
  AgentNativeFirstRunOnboardingMode,
} from "../../config.js";
import { injectedAgentNativeConfig } from "../app-config.js";

const FIRST_RUN_ONBOARDING_ENV_KEY = "VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING";
const FIRST_RUN_ONBOARDING_SKIP_INTEGRATIONS_ENV_KEY =
  "VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING_SKIP_INTEGRATIONS";

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

export function shouldSkipFirstRunIntegrations(
  env: FirstRunOnboardingEnv = (import.meta.env ?? {}) as FirstRunOnboardingEnv,
  config: AgentNativeConfig = injectedAgentNativeConfig(),
): boolean {
  if (env[FIRST_RUN_ONBOARDING_SKIP_INTEGRATIONS_ENV_KEY] !== undefined) {
    return isEnabled(env[FIRST_RUN_ONBOARDING_SKIP_INTEGRATIONS_ENV_KEY]);
  }
  return resolveFirstRunOnboardingMode(env, config) === "connect";
}

export function resolveFirstRunOnboardingMode(
  env: FirstRunOnboardingEnv = (import.meta.env ?? {}) as FirstRunOnboardingEnv,
  config: AgentNativeConfig = injectedAgentNativeConfig(),
): AgentNativeFirstRunOnboardingMode {
  const envOnboarding = env[FIRST_RUN_ONBOARDING_ENV_KEY];
  if (envOnboarding !== undefined) {
    if (!isEnabled(envOnboarding)) return "off";
    return isEnabled(env[FIRST_RUN_ONBOARDING_SKIP_INTEGRATIONS_ENV_KEY])
      ? "connect"
      : "connect-and-integrations";
  }

  const configured = config.onboarding?.firstRun;
  if (configured === "connect" || configured === "connect-and-integrations") {
    return isEnabled(env[FIRST_RUN_ONBOARDING_SKIP_INTEGRATIONS_ENV_KEY])
      ? "connect"
      : configured;
  }
  return "off";
}
