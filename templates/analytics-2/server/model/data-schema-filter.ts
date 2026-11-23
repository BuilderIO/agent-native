/**
 * Server entry point for the canonical schema-filter contract.
 *
 * The pure contract lives with the form model so the UI and save/readback use
 * one validation order. This module adds the explicit config read result and
 * never compiles or runs a user-supplied regular expression.
 */
import {
  readSchemaFilterShape,
  schemaFilterForSubmit,
  validateSchemaFilter,
  validateStringOrRegexFilter,
  isSchemaFilter,
  type FilterMatch,
  type FilterMode,
  type SchemaFilter,
  type SchemaFilterShapeIssue,
  type StringOrRegexFilter,
} from "../../app/components/data/schema-filter-model.js";

export {
  isSchemaFilter,
  schemaFilterForSubmit,
  validateSchemaFilter,
  validateStringOrRegexFilter,
};
export type {
  FilterMatch,
  FilterMode,
  SchemaFilter,
  SchemaFilterShapeIssue,
  StringOrRegexFilter,
};

export type SchemaFilterValidation = {
  schemaFilter: { message: string };
};

export type SchemaFilterConfigRead =
  | { status: "absent" }
  | { status: "cleared"; value: null }
  | { status: "valid"; value: SchemaFilter }
  | { status: "malformed"; reason: SchemaFilterShapeIssue };

/**
 * Read a persisted or submitted filter value without coercion. An absent value
 * stays absent, the explicit null clear state is preserved, and malformed data
 * fails with a stable reason instead of looking like an absent filter.
 */
export function parseSchemaFilterConfig(
  value: unknown,
): SchemaFilterConfigRead {
  if (value === undefined) return { status: "absent" };
  if (value === null) return { status: "cleared", value: null };
  const shape = readSchemaFilterShape(value);
  return shape.ok
    ? { status: "valid", value: shape.value }
    : { status: "malformed", reason: shape.reason };
}

/** Same validation order as the form, exposed for save/readback callers. */
export function validateSchemaFilterConfig(
  value: SchemaFilter | undefined,
): SchemaFilterValidation | undefined {
  return validateSchemaFilter({ schemaFilter: value });
}
