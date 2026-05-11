import { createCoreRoutesPlugin } from "@agent-native/core/server";
import { envKeys } from "../lib/env-config.js";
import { registerDispatchOnboardingSteps } from "../lib/onboarding-steps.js";

// Register before the core plugin so "create your first app" (order 5) appears
// above the auto-generated Slack/Telegram steps (order 60). Idempotent.
registerDispatchOnboardingSteps();

export default createCoreRoutesPlugin({
  envKeys,
});
