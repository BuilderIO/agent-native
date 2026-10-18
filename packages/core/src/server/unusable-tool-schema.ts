import {
  EMBED_START_LETTERS,
  HIDDEN_EMBED_URL,
  readString,
} from "../mcp/embed-redaction.js";
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
 * request, so when its reason or path names the start route, read loosely,
 * both are hidden whole, and the error, which holds them as written, is not
 * attached. A verdict that cannot be read is reported without them.
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
// is never called. A start URL in one can leave its ticket in the other, so
// one that names the route hides both, and so does one `readString` cannot
// read to the bottom or one already hidden. The route is read from the
// letters alone of each layer `readString` decodes, more loosely than
// `redactEmbedText` reads it: a path or `$ref` writes a key's `/` as JSON
// Pointer `~1`, under any escaping, and its digit would keep `embed` and
// `start` apart. A false match only hides a warning's reason and path.
function schemaTexts(values: unknown[]): string[] {
  const texts = values.map((value) =>
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "[not text]",
  );
  const namesRoute = texts.some((text) => {
    const { layers, complete, mentionsRoute } = readString(text);
    return (
      !complete ||
      mentionsRoute ||
      layers.some(
        (layer) =>
          layer.includes(HIDDEN_EMBED_URL) ||
          layer
            .toLowerCase()
            .replace(/[^a-z]/g, "")
            .includes(EMBED_START_LETTERS),
      )
    );
  });
  return namesRoute ? texts.map(() => HIDDEN_EMBED_URL) : texts;
}
