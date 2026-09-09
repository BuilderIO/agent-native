export {
  defineFeatureFlag,
  defineFeatureFlags,
  getFeatureFlagDefinition,
  listFeatureFlags,
  registerFeatureFlags,
  type FeatureFlagDefinition,
} from "./registry.js";
export {
  defaultFeatureFlagRules,
  evaluateFeatureFlag,
  evaluateFeatureFlagRules,
  hasActiveFeatureFlagRollout,
  isFeatureFlagEnabled,
  getFeatureFlagRules,
  normalizeFeatureFlagRules,
  type FeatureFlagMode,
  type FeatureFlagRules,
  type FeatureFlagScope,
} from "./store.js";
// Plugin and A2A auth stay on `./server` and `@agent-native/core/server`.
// Re-exporting them here pulls HMAC Node builtins into any Vite client that
// imports this barrel for `defineFeatureFlag` / `isFeatureFlagEnabled`.
