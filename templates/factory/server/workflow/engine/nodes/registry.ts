import type { NodeKind, WorkflowNode } from "../../contract.js";
import type { NodeExecutor, NodeExecutorFor } from "../types.js";
import { executeAction } from "./action.js";
import { executeAgent } from "./agent.js";
import { executeAi } from "./ai.js";
import { executeCombine } from "./combine.js";
import { executeEnd } from "./end.js";
import { executeFilter } from "./filter.js";
import { executeLookup } from "./lookup.js";
import { executeSource } from "./source.js";
import { executeSplit } from "./split.js";
import { executeSwitch } from "./switch.js";
import { executeTrigger } from "./trigger.js";
import { executeWait } from "./wait.js";

/** One executor per node kind; a kind with no entry would not compile. */
export const NODE_EXECUTORS: { [K in NodeKind]: NodeExecutorFor<K> } = {
  trigger: executeTrigger,
  source: executeSource,
  lookup: executeLookup,
  action: executeAction,
  filter: executeFilter,
  switch: executeSwitch,
  combine: executeCombine,
  split: executeSplit,
  ai: executeAi,
  agent: executeAgent,
  wait: executeWait,
  end: executeEnd,
};

/** The registry is typed per kind; a node carries its own kind, so the match holds. */
export function executorFor(node: WorkflowNode): NodeExecutor {
  return NODE_EXECUTORS[node.kind] as unknown as NodeExecutor;
}
