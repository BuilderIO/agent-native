import type { McpTool } from "./manager.js";

export type McpToolFamily = "browser" | "computer" | "other";
export type McpToolEffect = "read" | "write" | "unknown";

export interface McpToolCallClassification {
  family: McpToolFamily;
  effect: McpToolEffect;
  reason: string;
}

export interface McpToolInvocationPolicy {
  mode: "allow-all" | "read-only";
}

export interface McpToolPolicyDecision extends McpToolCallClassification {
  allowed: boolean;
}

const READ_OPERATIONS = new Set([
  "capture",
  "fetch",
  "get",
  "inspect",
  "list",
  "lookup",
  "observe",
  "query",
  "read",
  "search",
  "screenshot",
  "snapshot",
  "status",
  "view",
]);

const WRITE_OPERATIONS = new Set([
  "click",
  "close",
  "create",
  "delete",
  "drag",
  "evaluate",
  "execute",
  "fill",
  "focus",
  "hover",
  "key",
  "move",
  "navigate",
  "open",
  "press",
  "reload",
  "scroll",
  "select",
  "set",
  "submit",
  "type",
  "upload",
]);

/**
 * Classify an MCP call using both the declared tool and its runtime arguments.
 * Runtime inspection is necessary for combined computer tools whose `action`
 * selects between observation (for example `screenshot`) and mutation (for
 * example `click`). Unknown computer/browser operations intentionally remain
 * unknown so read-only callers can fail closed.
 */
export function classifyMcpToolCall(
  tool: McpTool,
  args: Record<string, unknown>,
): McpToolCallClassification {
  const family = classifyToolFamily(tool);
  if (family === "other") {
    if (tool.annotations?.readOnlyHint === true) {
      return {
        family,
        effect: "read",
        reason: "MCP readOnlyHint marks this tool as read-only",
      };
    }
    if (tool.annotations?.readOnlyHint === false) {
      return {
        family,
        effect: "write",
        reason: "MCP readOnlyHint marks this tool as mutating",
      };
    }
    return classifyKnownOperation(
      family,
      normalizedOperation(tool.originalName),
      "unannotated tool name",
    );
  }

  const runtimeAction = normalizedOperation(args.action);
  if (runtimeAction) {
    return classifyKnownOperation(family, runtimeAction, "runtime action");
  }

  const toolOperation = normalizedOperation(tool.originalName);
  return classifyKnownOperation(family, toolOperation, "tool name");
}

export function evaluateMcpToolCallPolicy(
  policy: McpToolInvocationPolicy,
  tool: McpTool,
  args: Record<string, unknown>,
): McpToolPolicyDecision {
  const classification = classifyMcpToolCall(tool, args);
  if (policy.mode === "allow-all") {
    return { ...classification, allowed: true };
  }

  // Plan mode is fail-closed. Unannotated tools remain available only when
  // their declared operation name is an explicitly recognized read verb.
  const allowed = classification.effect === "read";
  return { ...classification, allowed };
}

function classifyToolFamily(tool: McpTool): McpToolFamily {
  const source = normalizeIdentifier(tool.source);
  const name = normalizeIdentifier(tool.originalName);
  const combined = `${source} ${name}`;
  if (/\b(browser|chrome|playwright|puppeteer)\b/.test(combined)) {
    return "browser";
  }
  if (/\b(computer|desktop|screen|mouse|keyboard)\b/.test(combined)) {
    return "computer";
  }
  return "other";
}

function classifyKnownOperation(
  family: McpToolFamily,
  value: string | undefined,
  source: string,
): McpToolCallClassification {
  if (!value) {
    return {
      family,
      effect: "unknown",
      reason: `${family} ${source} is missing or ambiguous`,
    };
  }
  const tokens = value.split(" ");
  if (tokens.some((token) => WRITE_OPERATIONS.has(token))) {
    return {
      family,
      effect: "write",
      reason: `${family} ${source} selects a mutating operation`,
    };
  }
  if (tokens.some((token) => READ_OPERATIONS.has(token))) {
    return {
      family,
      effect: "read",
      reason: `${family} ${source} selects an observation operation`,
    };
  }
  return {
    family,
    effect: "unknown",
    reason:
      family === "other"
        ? `${family} ${source} is not a recognized safe read operation`
        : `${family} ${source} is not a recognized safe observation operation`,
  };
}

function normalizedOperation(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeIdentifier(value);
  return normalized || undefined;
}

function normalizeIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
