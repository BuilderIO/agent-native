import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { OperationDefinition } from "../workflow/operations.js";

/** The catalog's definition of an operation a host action implements. */
export function catalogOperation(id: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(id);
  if (!def) throw new TypeError(`${id} is not in the operation catalog.`);
  return def;
}

/**
 * The read a write makes first. It keeps the write's id, so what it reports
 * belongs to that step, but a failure of it is a read's: it never reads as a
 * write that may have happened.
 */
export function asRead(def: OperationDefinition): OperationDefinition {
  return { ...def, effect: "read" };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text, or a finite number as text; nothing for an empty string or any other value. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
