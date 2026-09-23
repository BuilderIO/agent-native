// Server-only. Uses the LaunchDarkly Node SDK — never import this from
// client/browser code. Browser code should use
// `@agent-native/core/client/launchdarkly` instead, which reads evaluated
// flags through the `get-launchdarkly-flags` action rather than a
// LaunchDarkly client-side SDK.
export { closeLaunchDarklyClient, getLaunchDarklyClient } from "./client.js";
export { buildLaunchDarklyContext, type LaunchDarklyActor } from "./context.js";
export {
  getAllLaunchDarklyFlags,
  getLaunchDarklyVariation,
  isLaunchDarklyFlagEnabled,
} from "./evaluate.js";
