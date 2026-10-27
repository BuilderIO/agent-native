import { isMcpReadOnlyTool } from "../action-call-classification.js";
import { ACTION_EXECUTION_KEY } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { carryFrameworkMcpTool } from "../mcp/framework-tools.js";

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

/** A flag's type once its runtime check has passed. */
type Flag<K extends keyof ActionEntry> = NonNullable<ActionEntry[K]>;

function isPlainObject(value: unknown): value is object {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Annotations that set each of the three required hints to a boolean. */
function isMcpAnnotations(value: unknown): value is Flag<"mcpAnnotations"> {
  if (!isPlainObject(value)) return false;
  const hints = value as Record<string, unknown>;
  return (
    typeof hints.readOnlyHint === "boolean" &&
    typeof hints.destructiveHint === "boolean" &&
    typeof hints.openWorldHint === "boolean"
  );
}

/**
 * The flags of a loaded action module that every registry keeps, so an action
 * validates, asks for approval, and checks access the same way however it was
 * loaded. Each flag is kept only when its value has the right shape.
 */
export function preserveActionFlags(
  entry: Record<string, unknown>,
): Partial<ActionEntry> {
  const out: Partial<ActionEntry> = {};
  carryFrameworkMcpTool(entry, out);
  if (
    entry.schema &&
    typeof entry.schema === "object" &&
    "~standard" in entry.schema
  ) {
    out.schema = entry.schema;
  }
  if (isPlainObject(entry.access)) {
    out.access = entry.access as Flag<"access">;
  }
  if (typeof entry.agentTool === "boolean") out.agentTool = entry.agentTool;
  if (typeof entry.mcpTool === "boolean") out.mcpTool = entry.mcpTool;
  if (isMcpAnnotations(entry.mcpAnnotations)) {
    out.mcpAnnotations = entry.mcpAnnotations;
  }
  const outputContract = entry.mcpOutputContract;
  if (
    outputContract &&
    typeof outputContract === "object" &&
    "response" in outputContract &&
    outputContract.response &&
    typeof outputContract.response === "object"
  ) {
    out.mcpOutputContract = outputContract as Flag<"mcpOutputContract">;
  }
  if (typeof entry.deferLoading === "boolean") {
    out.deferLoading = entry.deferLoading;
  }
  if (typeof entry.requiresAuth === "boolean") {
    out.requiresAuth = entry.requiresAuth;
  }
  if (typeof entry.uiOnly === "boolean") out.uiOnly = entry.uiOnly;
  if (typeof entry.readOnly === "boolean") out.readOnly = entry.readOnly;
  if (typeof entry.grounding === "boolean") out.grounding = entry.grounding;
  if (typeof entry.allowInPlanMode === "boolean") {
    out.allowInPlanMode = entry.allowInPlanMode;
  }
  if (isPlainObject(entry.planMode)) {
    out.planMode = entry.planMode as Flag<"planMode">;
  }
  if (typeof entry.changeEvents === "boolean") {
    out.changeEvents = entry.changeEvents;
  }
  if (typeof entry.persistInBrowser === "boolean") {
    out.persistInBrowser = entry.persistInBrowser;
  }
  if (typeof entry.changeResource === "function") {
    out.changeResource = entry.changeResource as Flag<"changeResource">;
  }
  if (typeof entry.parallelSafe === "boolean") {
    out.parallelSafe = entry.parallelSafe;
  }
  if (
    typeof entry.retrySafe === "boolean" ||
    typeof entry.retrySafe === "function"
  ) {
    out.retrySafe = entry.retrySafe as Flag<"retrySafe">;
  }
  carryExecutionKey(entry, out);
  if (typeof entry.endsTurn === "boolean") {
    out.endsTurn = entry.endsTurn;
  }
  if (typeof entry.dedupe === "boolean") {
    out.dedupe = entry.dedupe;
  }
  if (typeof entry.toolCallable === "boolean") {
    out.toolCallable = entry.toolCallable;
  }
  if (typeof entry.agentDiscoveryAvailable === "function") {
    out.agentDiscoveryAvailable =
      entry.agentDiscoveryAvailable as Flag<"agentDiscoveryAvailable">;
  }
  if (
    Array.isArray(entry.capabilityScopes) &&
    entry.capabilityScopes.length > 0 &&
    entry.capabilityScopes.every((scope: unknown) => typeof scope === "string")
  ) {
    out.capabilityScopes = entry.capabilityScopes;
  }
  if (isPlainObject(entry.publicAgent)) {
    out.publicAgent = entry.publicAgent as Flag<"publicAgent">;
  }
  if (typeof entry.link === "function") {
    out.link = entry.link as Flag<"link">;
  }
  if (isPlainObject(entry.mcpApp)) {
    out.mcpApp = entry.mcpApp as Flag<"mcpApp">;
  }
  if (isPlainObject(entry.chatUI)) {
    out.chatUI = entry.chatUI as Flag<"chatUI">;
  }
  if (typeof entry.timeoutMs === "number") out.timeoutMs = entry.timeoutMs;
  if (typeof entry.maxResultChars === "number") {
    out.maxResultChars = entry.maxResultChars;
  }
  if (typeof entry.maxBodyBytes === "number") {
    out.maxBodyBytes = entry.maxBodyBytes;
  }
  if (
    typeof entry.needsApproval === "boolean" ||
    typeof entry.needsApproval === "function"
  ) {
    out.needsApproval = entry.needsApproval as Flag<"needsApproval">;
  }
  if (typeof entry.allowPersistentApproval === "boolean") {
    out.allowPersistentApproval = entry.allowPersistentApproval;
  }
  if (entry.zonelessTimes === "calendar") {
    out.zonelessTimes = entry.zonelessTimes;
  }
  return out;
}

function definesAction(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const def = value as Record<string, unknown>;
  return !!def.tool && typeof def.run === "function";
}

/**
 * The object a loaded action module defines its action on. Named `tool` and
 * `run` exports come first, as the built registry and the directory loader
 * take them, so the dev scan registers the same action production does.
 * Otherwise it's the default-exported object, if that's an action.
 */
export function actionDefinition(
  mod: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const { default: defaultExport } = mod;
  if (definesAction(mod)) return mod;
  return definesAction(defaultExport) ? defaultExport : undefined;
}

/**
 * The entry the dev filesystem scan registers for a loaded action module: the
 * real `run` plus the same flags a built registry keeps, and conservative MCP
 * annotations when the module declares no valid ones.
 */
export function filesystemActionEntry(def: Record<string, any>): ActionEntry {
  const flags = preserveActionFlags(def);
  const out: ActionEntry = {
    tool: def.tool,
    run: def.run,
    ...(def.http !== undefined ? { http: def.http } : {}),
    ...flags,
    ...(flags.mcpAnnotations
      ? {}
      : {
          mcpAnnotationDefaults: discoveredActionMcpAnnotations(
            isMcpReadOnlyTool(flags),
          ),
        }),
  };
  carryFrameworkMcpTool(def as ActionEntry, out);
  carryExecutionKey(def, out);
  return out;
}
