import { isMcpReadOnlyTool } from "../action-call-classification.js";
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

const DISCOVERED_READ_ONLY_HINTS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const);
const DISCOVERED_WRITE_HINTS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const);

// Filesystem discovery can expose loose actions over MCP. Unknown actions may
// interact externally, so their open-world hint stays conservative.
export function discoveredActionMcpAnnotations(readOnly: boolean) {
  return readOnly ? DISCOVERED_READ_ONLY_HINTS : DISCOVERED_WRITE_HINTS;
}

/**
 * The entry the dev filesystem scan registers for a loaded action module: the
 * real `run` plus the few fields that scan has always carried.
 */
export function filesystemActionEntry(def: Record<string, any>): ActionEntry {
  const readOnly = typeof def.readOnly === "boolean" ? def.readOnly : undefined;
  const planMode =
    def.planMode && typeof def.planMode === "object"
      ? (def.planMode as ActionEntry["planMode"])
      : undefined;
  const out: ActionEntry = {
    tool: def.tool,
    run: def.run,
    ...(def.http !== undefined ? { http: def.http } : {}),
    ...(readOnly !== undefined ? { readOnly } : {}),
    ...(planMode ? { planMode } : {}),
    ...(def.mcpAnnotations
      ? { mcpAnnotations: def.mcpAnnotations }
      : {
          mcpAnnotationDefaults: discoveredActionMcpAnnotations(
            isMcpReadOnlyTool({ readOnly, planMode }),
          ),
        }),
    ...(typeof def.agentTool === "boolean" ? { agentTool: def.agentTool } : {}),
    ...(typeof def.retrySafe === "boolean" ||
    typeof def.retrySafe === "function"
      ? { retrySafe: def.retrySafe }
      : {}),
    ...(def.zonelessTimes === "calendar"
      ? { zonelessTimes: def.zonelessTimes }
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
