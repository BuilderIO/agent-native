/**
 * The server's single reader of the build-embedded first-run onboarding mode.
 *
 * The mode is resolved once, at build time, from the same app config and
 * `VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING` override the browser bundle reads
 * (`client/onboarding/first-run-enabled.ts`), then embedded into the server
 * bundle as a literal environment read of
 * `AGENT_NATIVE_BUILD_FIRST_RUN_ONBOARDING` (Vite `define`, Nitro `replace`,
 * and the deploy build's own replacement map — see
 * `resolveFirstRunOnboardingBuildReplacement` in
 * `vite/agent-native-config-loader.ts`). A runtime read of `agent-native.json`
 * is not an option: the file isn't shipped into a deployed server function,
 * so resolving "absent" would read the same as "off" and silently stop
 * onboarding for every app in production.
 *
 * Keep this the only environment read of that key.
 */
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

/**
 * Whether `tryCreateDefaultOrg` should still write the first-run eligibility
 * marker. An un-embedded build (older bundle, or a build-time resolution
 * failure) MUST keep writing it — the marker only needs to be positively
 * known unnecessary, never merely unconfirmed, since Clips/Calendar/Mail/
 * Slides/Design depend on it to show onboarding at all.
 */
export function shouldWriteFirstRunOnboardingEligibility(): boolean {
  const mode = readBuildFirstRunOnboardingMode();
  return mode === undefined || isFirstRunOnboardingModeActive(mode);
}
