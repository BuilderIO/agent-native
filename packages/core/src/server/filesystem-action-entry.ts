import { ACTION_EXECUTION_KEY } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";

// Without the key an app wrapper around `run` cannot be recognized as the same
// action, and every validation failure reads as an unknown write.
export function carryExecutionKey(from: object, to: object): void {
  const executionKey = (from as Record<symbol, unknown>)[ACTION_EXECUTION_KEY];
  if (executionKey !== null && typeof executionKey === "object") {
    Object.defineProperty(to, ACTION_EXECUTION_KEY, {
      value: executionKey,
      enumerable: true,
    });
  }
}

/**
 * The entry the dev filesystem scan registers for a loaded action module: the
 * real `run` plus the few fields that scan has always carried.
 */
export function filesystemActionEntry(def: Record<string, any>): ActionEntry {
  const out: ActionEntry = {
    tool: def.tool,
    run: def.run,
    ...(def.http !== undefined ? { http: def.http } : {}),
    ...(typeof def.agentTool === "boolean" ? { agentTool: def.agentTool } : {}),
    ...(typeof def.retrySafe === "boolean" ||
    typeof def.retrySafe === "function"
      ? { retrySafe: def.retrySafe }
      : {}),
    ...(def.chatUI &&
    typeof def.chatUI === "object" &&
    !Array.isArray(def.chatUI)
      ? { chatUI: def.chatUI }
      : {}),
  };
  carryExecutionKey(def, out);
  return out;
}
