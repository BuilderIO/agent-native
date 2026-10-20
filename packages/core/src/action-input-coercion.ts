import type { ActionTool } from "./agent/types.js";

const NO_COERCE = Symbol("no-coerce");

function coerceStringToSchemaType(raw: string, types: string[]): unknown {
  const trimmed = raw.trim();
  if (types.includes("boolean")) {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
  }
  if (
    (types.includes("array") &&
      trimmed.startsWith("[") &&
      trimmed.endsWith("]")) ||
    (types.includes("object") &&
      trimmed.startsWith("{") &&
      trimmed.endsWith("}"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (types.includes("array") && Array.isArray(parsed)) return parsed;
      if (
        types.includes("object") &&
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }
      // coercion-ok: unparseable text stays a string and schema validation rejects it
    } catch {
      // fall through — leave the original so validation reports the real error
    }
  }
  if (
    (types.includes("number") || types.includes("integer")) &&
    trimmed !== "" &&
    Number.isFinite(Number(trimmed))
  ) {
    const n = Number(trimmed);
    if (types.includes("number") || Number.isInteger(n)) return n;
  }
  return NO_COERCE;
}

/**
 * The repair a tool call's arguments get before schema validation: a gateway
 * that stringifies `true`, `3`, or a JSON array/object is undone per the
 * declared parameter type. Anything that reads a call's input to decide what
 * the handler will do (`retrySafe`) must see this form, not the raw model
 * input, or a stringified flag passes a strict comparison and still runs as
 * `true`.
 */
export function coerceGatewayStringifiedArgs(
  args: unknown,
  parameters?: ActionTool["parameters"],
): unknown {
  const properties = parameters?.properties as
    | Record<string, { type?: string | string[] }>
    | undefined;
  if (!properties) return args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  let out: Record<string, unknown> | null = null;
  for (const [key, raw] of Object.entries(args as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const spec = properties[key];
    if (!spec) continue;
    const types = Array.isArray(spec.type)
      ? spec.type
      : spec.type
        ? [spec.type]
        : [];
    if (types.length === 0 || types.includes("string")) continue;
    const coerced = coerceStringToSchemaType(raw, types);
    if (coerced === NO_COERCE) continue;
    if (!out) out = { ...(args as Record<string, unknown>) };
    out[key] = coerced;
  }
  return out ?? args;
}
