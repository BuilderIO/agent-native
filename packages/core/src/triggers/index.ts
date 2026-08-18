export type { TriggerFrontmatter, TriggerDispatchContext } from "./types.js";
export {
  initTriggerDispatcher,
  refreshEventSubscriptions,
  parseTriggerFrontmatter,
  buildTriggerContent,
  type TriggerDispatcherDeps,
} from "./dispatcher.js";
export {
  evaluateCondition,
  __clearConditionCache,
} from "./condition-evaluator.js";
export { createAutomationToolEntries } from "./actions.js";

// Template-native automation surfaces use the same organization-scoped
// service and run history as the framework Agent page.
export {
  defineAutomation,
  listAutomationDefinitions,
  updateAutomation,
  type AutomationActor,
  type AutomationDefinition,
} from "../automations/service.js";
export { queueAutomationRunNow } from "../jobs/run-now.js";
export { listAutomationRuns } from "../jobs/run-history.js";
