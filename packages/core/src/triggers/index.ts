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

export {
  defineAutomation,
  listAutomationDefinitions,
  updateAutomation,
  type AutomationActor,
  type AutomationDefinition,
} from "../automations/service.js";
export { queueAutomationRunNow } from "../jobs/run-now.js";
export {
  deleteAutomationRuns,
  listAutomationRuns,
} from "../jobs/run-history.js";
