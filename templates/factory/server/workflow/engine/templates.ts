import {
  evaluateTemplate,
  type ExpressionResult,
  type Scope,
} from "../expressions.js";
import { isRecord } from "./bounds.js";

/**
 * Fills every `{{ }}` hole in a JSON value, however deep. A string that is
 * exactly one hole keeps its value's type; any hole with no value fails the
 * whole value rather than rendering blank.
 */
export function resolveTemplates(
  value: unknown,
  scope: Scope,
): ExpressionResult<unknown> {
  if (typeof value === "string") return evaluateTemplate(value, scope);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const entry of value) {
      const resolved = resolveTemplates(entry, scope);
      if (!resolved.ok) return resolved;
      out.push(resolved.value);
    }
    return { ok: true, value: out };
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const resolved = resolveTemplates(entry, scope);
      if (!resolved.ok) return resolved;
      out[key] = resolved.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value };
}
