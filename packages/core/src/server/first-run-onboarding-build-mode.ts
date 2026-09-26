import {
  isFirstRunOnboardingModeActive,
  type AgentNativeFirstRunOnboardingMode,
} from "../config.js";

function readBuildFirstRunOnboardingMode():
  | AgentNativeFirstRunOnboardingMode
  | undefined {
  // config-ok: embedded at build time by literal replacement, which the
  // app-config env layer's dynamic lookup cannot see (see module comment)
  const raw = process.env.AGENT_NATIVE_BUILD_FIRST_RUN_ONBOARDING;
  return raw === "off" ||
    raw === "connect" ||
    raw === "connect-and-integrations"
    ? raw
    : undefined;
}

export function shouldWriteFirstRunOnboardingEligibility(): boolean {
  const mode = readBuildFirstRunOnboardingMode();
  return mode === undefined || isFirstRunOnboardingModeActive(mode);
}
