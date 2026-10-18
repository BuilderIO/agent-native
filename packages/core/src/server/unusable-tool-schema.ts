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
 * request, so when its reason or path names the start route, as
 * `redactEmbedText` reads text, both are hidden whole, and the error, which
 * holds them as written, is not attached. A verdict that cannot be read is
 * reported without them.
 */
export function reportUnusableToolSchema(
  surface: keyof typeof SURFACES,
  action: string,
  error: Error & { path: string; reason: string },
): void {
  const leftOut = `Action "${action}" is left out of ${SURFACES[surface]}`;
  let message = `${leftOut}: its input schema is not usable, and why could not be read.`;
  let extra: Record<string, unknown> = { action };
  try {
    const [reason, path] = schemaTexts([error.reason, error.path]);
    message = `${leftOut}: its input schema ${reason} at ${path || "/"}.`;
    extra = { action, path, reason };
  } catch {
    // coercion-ok: a verdict that cannot be read is reported as one.
  }
  const key = `${surface}\n${message}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.error(`[${surface}] ${message}`);
  captureError(new Error(message), {
    tags: { source: surface, failureClass: "unusable-tool-schema" },
    extra,
  });
}

// A verdict's fields can be a schema emitter's, so one that is not a string
// is never called. A path, and a `$ref` in a reason, escape a key's `/` as
// `~1`, which `redactEmbedText` does not decode, so each is read decoded too.
// A start URL in one can leave its ticket in the other, so one that names the
// route, or shows one already hidden, hides both.
function schemaTexts(values: unknown[]): string[] {
  const texts = values.map((value) =>
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "[not text]",
  );
  const namesRoute = texts.some((text) => {
    const decoded = text.replace(/~1/g, "/").replace(/~0/g, "~");
    return (
      text.includes(HIDDEN_EMBED_URL) ||
      redactEmbedText(text) !== text ||
      redactEmbedText(decoded) !== decoded
    );
  });
  return namesRoute ? texts.map(() => HIDDEN_EMBED_URL) : texts;
}
