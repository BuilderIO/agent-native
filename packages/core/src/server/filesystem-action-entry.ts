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
 * The flags of a loaded action module that every registry keeps, so an action
 * validates, asks for approval, and checks access the same way however it was
 * loaded.
 */
export function preserveActionFlags(
  entry: Record<string, any>,
): Partial<ActionEntry> {
  const out: Partial<ActionEntry> = {};
  if (
    entry.schema &&
    typeof entry.schema === "object" &&
    "~standard" in entry.schema
  ) {
    out.schema = entry.schema;
  }
  if (
    entry.access &&
    typeof entry.access === "object" &&
    !Array.isArray(entry.access)
  ) {
    out.access = entry.access;
  }
  if (typeof entry.agentTool === "boolean") out.agentTool = entry.agentTool;
  if (typeof entry.mcpTool === "boolean") out.mcpTool = entry.mcpTool;
  if (
    entry.mcpAnnotations &&
    typeof entry.mcpAnnotations === "object" &&
    !Array.isArray(entry.mcpAnnotations) &&
    typeof entry.mcpAnnotations.readOnlyHint === "boolean" &&
    typeof entry.mcpAnnotations.destructiveHint === "boolean" &&
    typeof entry.mcpAnnotations.openWorldHint === "boolean"
  ) {
    out.mcpAnnotations = entry.mcpAnnotations;
  }
  if (
    entry.mcpOutputContract &&
    typeof entry.mcpOutputContract === "object" &&
    entry.mcpOutputContract.response &&
    typeof entry.mcpOutputContract.response === "object"
  ) {
    out.mcpOutputContract = entry.mcpOutputContract;
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
  if (
    entry.planMode &&
    typeof entry.planMode === "object" &&
    !Array.isArray(entry.planMode)
  ) {
    out.planMode = entry.planMode;
  }
  if (typeof entry.changeEvents === "boolean") {
    out.changeEvents = entry.changeEvents;
  }
  if (typeof entry.persistInBrowser === "boolean") {
    out.persistInBrowser = entry.persistInBrowser;
  }
  if (typeof entry.changeResource === "function") {
    out.changeResource = entry.changeResource;
  }
  if (typeof entry.parallelSafe === "boolean") {
    out.parallelSafe = entry.parallelSafe;
  }
  if (
    typeof entry.retrySafe === "boolean" ||
    typeof entry.retrySafe === "function"
  ) {
    out.retrySafe = entry.retrySafe;
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
    out.agentDiscoveryAvailable = entry.agentDiscoveryAvailable;
  }
  if (
    Array.isArray(entry.capabilityScopes) &&
    entry.capabilityScopes.length > 0 &&
    entry.capabilityScopes.every((scope: unknown) => typeof scope === "string")
  ) {
    out.capabilityScopes = entry.capabilityScopes;
  }
  if (
    entry.publicAgent &&
    typeof entry.publicAgent === "object" &&
    !Array.isArray(entry.publicAgent)
  ) {
    out.publicAgent = entry.publicAgent;
  }
  if (typeof entry.link === "function") {
    out.link = entry.link;
  }
  if (
    entry.mcpApp &&
    typeof entry.mcpApp === "object" &&
    !Array.isArray(entry.mcpApp)
  ) {
    out.mcpApp = entry.mcpApp;
  }
  if (
    entry.chatUI &&
    typeof entry.chatUI === "object" &&
    !Array.isArray(entry.chatUI)
  ) {
    out.chatUI = entry.chatUI;
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
    out.needsApproval = entry.needsApproval;
  }
  if (typeof entry.allowPersistentApproval === "boolean") {
    out.allowPersistentApproval = entry.allowPersistentApproval;
  }
  return out;
}

/**
 * The entry the dev filesystem scan registers for a loaded action module: the
 * real `run` plus the same flags a built registry keeps, and conservative MCP
 * annotations when the module declares none.
 */
export function filesystemActionEntry(def: Record<string, any>): ActionEntry {
  const flags = preserveActionFlags(def);
  const out: ActionEntry = {
    tool: def.tool,
    run: def.run,
    ...(def.http !== undefined ? { http: def.http } : {}),
    ...flags,
    ...(def.mcpAnnotations
      ? { mcpAnnotations: def.mcpAnnotations }
      : {
          mcpAnnotationDefaults: discoveredActionMcpAnnotations(
            isMcpReadOnlyTool({
              readOnly: flags.readOnly,
              planMode: flags.planMode,
            }),
          ),
        }),
  };
  carryExecutionKey(def, out);
  return out;
}
