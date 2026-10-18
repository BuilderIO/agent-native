import { HIDDEN_EMBED_URL, redactEmbedText } from "../mcp/embed-redaction.js";
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
 * process instead of once per build. A schema can hold a call's data, since an
 * action's `parameters` are kept by reference and converted again for every
 * request, so its reason and path are hidden whole as `redactEmbedText` hides
 * text, and the error, which holds them as written, is not attached.
 */
export function reportUnusableToolSchema(
  surface: keyof typeof SURFACES,
  action: string,
  error: Error & { path: string; reason: string },
): void {
  const reason = schemaText(error.reason);
  const path = schemaText(error.path);
  const message =
    `Action "${action}" is left out of ${SURFACES[surface]}: its input ` +
    `schema ${reason} at ${path || "/"}.`;
  const key = `${surface}\n${message}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.error(`[${surface}] ${message}`);
  captureError(new Error(message), {
    tags: { source: surface, failureClass: "unusable-tool-schema" },
    extra: { action, path, reason },
  });
}

// A path, and a `$ref` in a reason, escape a key's `/` as `~1`, which
// `redactEmbedText` does not decode, so the decoded pointer is read too.
function schemaText(text: string): string {
  const decoded = text.replace(/~1/g, "/").replace(/~0/g, "~");
  return redactEmbedText(decoded) === decoded
    ? redactEmbedText(text)
    : HIDDEN_EMBED_URL;
}
