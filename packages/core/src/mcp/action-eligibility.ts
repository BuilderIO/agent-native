import type { ActionEntry } from "../agent/production-agent.js";
import { isFrameworkMcpTool } from "./framework-tools.js";

const RAW_QUERY_INPUT_FIELDS = new Set(["sql", "code", "script", "expression"]);

export function hasRawQueryInput(entry: ActionEntry): boolean {
  return hasRawQueryParameters(entry.tool?.parameters);
}

function hasRawQueryParameters(input: unknown): boolean {
  const parameters = input as
    | { properties?: Record<string, { type?: unknown }> }
    | undefined;
  const properties = parameters?.properties;
  if (!properties || typeof properties !== "object") return false;
  return Object.entries(properties).some(([field, schema]) => {
    const type = schema?.type;
    const acceptsString =
      type === "string" ||
      type === undefined ||
      (Array.isArray(type) && type.includes("string"));
    return RAW_QUERY_INPUT_FIELDS.has(field.toLowerCase()) && acceptsString;
  });
}

const AUTO_READ_EXCLUDED_ACTION_NAMES = new Set([
  "db-query",
  "db-schema",
  "db-exec",
  "db-patch",
  "context-manifest-get",
  "context-preview-get",
  "context-pin",
  "context-evict",
  "context-restore",
  "context-report",
  "context-compact",
  "context-compaction-get",
]);

const AUTO_READ_EXCLUDED_ACTION_PATTERNS: RegExp[] = [
  /^seed-/,
  /extension/,
  /browser-session/,
];

export function isAutoReadExcludedActionName(name: string): boolean {
  return (
    AUTO_READ_EXCLUDED_ACTION_NAMES.has(name) ||
    AUTO_READ_EXCLUDED_ACTION_PATTERNS.some((pattern) => pattern.test(name))
  );
}

const RUNTIME_ONLY_ACTION_NAMES = new Set([
  "core-send-email",
  "fetch",
  "web-request",
  "call-agent",
  "manage-agent-engine",
  "manage-agent-loop-settings",
  "web-search",
  "run-code",
  "tool-orchestration",
  "get-code-execution",
  "workspace-files",
  "activate-browser",
  "set-browser-control",
  "set-computer-use",
  "list-remote-browser-devices",
  "read-remote-browser-page",
  "control-remote-browser",
  "get-remote-browser-command",
  "bash",
  "read",
  "edit",
  "write",
  "shell",
  "read-file",
  "write-file",
  "search-files",
]);

// These framework entries already appear in default app catalogs. An entry's
// own opt-out and the request's catalog policy still apply after this check.
const ALLOWED_FRAMEWORK_ACTION_NAMES = new Set([
  "invite-organization-member",
  "list-organization-members",
  "list-resource-shares",
  "manage-automations",
  "navigate",
  "set-resource-visibility",
  "share-resource",
  "tool-search",
  "unshare-resource",
  "upload-image",
  "view-screen",
]);

export function isMcpActionEligible(name: string, entry: ActionEntry): boolean {
  return (
    isMcpActionNameEligible(name, entry) &&
    isMcpActionInputEligible(entry, entry.tool.parameters)
  );
}

export function isMcpActionInputEligible(
  entry: ActionEntry,
  parameters: unknown,
): boolean {
  return (
    !hasRawQueryParameters(parameters) ||
    entry.publicAgent?.allowRawQueryInput === true
  );
}

export function isMcpActionNameEligible(
  name: string,
  entry: ActionEntry,
): boolean {
  return (
    !RUNTIME_ONLY_ACTION_NAMES.has(name) &&
    !/^(?:db-|provider-api-|seed-)/i.test(name) &&
    !isAutoReadExcludedActionName(name) &&
    entry.cliWrapper !== true &&
    (!isFrameworkMcpTool(entry) || ALLOWED_FRAMEWORK_ACTION_NAMES.has(name))
  );
}
