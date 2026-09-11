/**
 * Prompt module barrel — re-exports all prompt builders and constants so
 * agent-chat-plugin.ts has a single clean import.
 */

export { buildFrameworkCore } from "./framework-core.js";
export { buildFrameworkCoreCompact } from "./framework-core-compact.js";
export {
  sharedRule8,
  SHARED_RULE_9,
  sharedRule13,
  SHARED_RULE_14,
  SHARED_RULE_15,
  type PromptExamples,
  type SharedRuleOptions,
} from "./shared-rules.js";
export { getModelFamilyOverlay } from "./model-overlays.js";
