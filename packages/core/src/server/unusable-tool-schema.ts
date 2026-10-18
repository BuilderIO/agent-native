import { captureError } from "./capture-error.js";

const SURFACES = {
  agent: "the agent's tools",
  mcp: "the MCP tool list",
} as const;

const reported = new Set<string>();

/**
 * Reports an action left out of a tool list because its input schema cannot
 * be sent to a provider. The other tools keep serving, so this log and capture
 * are the only sign the action is missing. Both lists are rebuilt for every
 * MCP request and agent run, so each distinct message is reported once per
 * process instead of once per build.
 */
export function reportUnusableToolSchema(
  surface: keyof typeof SURFACES,
  action: string,
  error: Error & { path: string; reason: string },
): void {
  const message =
    `Action "${action}" is left out of ${SURFACES[surface]}: its input ` +
    `schema ${error.reason} at ${error.path || "/"}.`;
  const key = `${surface}\n${message}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.error(`[${surface}] ${message}`);
  captureError(new Error(message, { cause: error }), {
    tags: { source: surface, failureClass: "unusable-tool-schema" },
    extra: { action, path: error.path, reason: error.reason },
  });
}
