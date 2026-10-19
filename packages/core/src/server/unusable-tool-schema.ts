import {
  HIDDEN_EMBED_URL,
  MAX_DECODE_ROUNDS,
  readString,
} from "../mcp/embed-redaction.js";
import { captureError } from "./capture-error.js";

const SURFACES = {
  agent: "the agent's tools",
  mcp: "the MCP tool list",
} as const;

const reported = new Set<string>();
const MAX_POINTER_READS = 64;

/**
 * Reports an action left out of a tool list because its input schema cannot
 * be sent to a provider. The other tools keep serving, so this log and capture
 * are the only sign the action is missing. Both lists are rebuilt for every
 * MCP request and agent run, so each distinct message is reported once per
 * process instead of once per build. A schema can hold a call's data, since an
 * action's `parameters` are kept by reference and converted again for every
 * request, so when its reason or path names the start route, escaped or as a
 * JSON Pointer, both are hidden whole, and the error, which holds them as
 * written, is not attached. A verdict that cannot be read is reported without
 * them.
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
// one that names the route hides both.
function schemaTexts(values: unknown[]): string[] {
  const texts = values.map((value) =>
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "[not text]",
  );
  return texts.some(namesRoute) ? texts.map(() => HIDDEN_EMBED_URL) : texts;
}

// A path or `$ref` writes a key's `/` as JSON Pointer `~1`, under any
// escaping, and a key that holds a pointer is encoded again, so each layer
// `readString` decodes is pointer-decoded and read again for as long as that
// changes it. The shared reader then resolves its dot segments and folds its
// compatibility forms as it does a URL's. A field already hidden, or one not
// read to the bottom within `MAX_DECODE_ROUNDS` pointer decodes and
// `MAX_POINTER_READS` reads, counts as naming the route.
function namesRoute(text: string): boolean {
  const seen = new Set([text]);
  let round = [text];
  for (let depth = 0; round.length > 0; depth += 1) {
    const next: string[] = [];
    for (const current of round) {
      const { layers, complete, mentionsRoute } = readString(current);
      if (
        !complete ||
        mentionsRoute ||
        layers.some((layer) => layer.includes(HIDDEN_EMBED_URL))
      ) {
        return true;
      }
      for (const layer of layers) {
        const decoded = layer.replace(/~1/g, "/").replace(/~0/g, "~");
        if (decoded === layer || seen.has(decoded)) continue;
        if (depth === MAX_DECODE_ROUNDS || seen.size === MAX_POINTER_READS) {
          return true;
        }
        seen.add(decoded);
        next.push(decoded);
      }
    }
    round = next;
  }
  return false;
}
