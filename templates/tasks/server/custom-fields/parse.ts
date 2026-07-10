/**
 * Read path: DB rows (JSON columns) → typed field definitions and values.
 * Structural parsing uses schema.ts; domain rules use validate.ts; then normalize.
 */
import type {
  StoredCustomField,
  StoredCustomFieldValue,
} from "../db/schema.js";
import {
  canonicalizeFieldConfig,
  isEmptyFieldValue,
  normalizeFieldConfigInput,
  normalizeFieldValue,
} from "./normalize.js";
import {
  emptyConfigShapeSchema,
  currencyConfigShapeSchema,
  fieldTypeSchema,
  fieldValueInputSchema,
  numericConfigShapeSchema,
  percentConfigShapeSchema,
  selectConfigShapeSchema,
} from "./schema.js";
import type {
  FieldConfigInput,
  FieldDefinition,
  FieldType,
  FieldValue,
  FieldValueInput,
} from "./types.js";
import { validateFieldConfig, validateFieldValue } from "./validate.js";

export function parseFieldType(value: unknown): FieldType {
  return fieldTypeSchema.parse(value);
}

export function parseFieldConfigShape<T extends FieldType>(
  type: T,
  config: unknown,
): FieldConfigInput<T> {
  if (type === "text" || type === "rich_text" || type === "date") {
    emptyConfigShapeSchema.parse(config ?? {});
    return {} as FieldConfigInput<T>;
  }

  if (type === "number") {
    return numericConfigShapeSchema.parse(config ?? {}) as FieldConfigInput<T>;
  }

  if (type === "percent") {
    return percentConfigShapeSchema.parse(config ?? {}) as FieldConfigInput<T>;
  }

  if (type === "currency") {
    return currencyConfigShapeSchema.parse(config ?? {}) as FieldConfigInput<T>;
  }

  return selectConfigShapeSchema.parse(config ?? {}) as FieldConfigInput<T>;
}

export function parseFieldValueShape(value: unknown): FieldValueInput {
  return fieldValueInputSchema.parse(value);
}

export function parseField(row: StoredCustomField): FieldDefinition {
  const type = parseFieldType(row.type);
  const shaped = parseFieldConfigShape(type, JSON.parse(row.configJson));
  validateFieldConfig(type, shaped);
  const config = canonicalizeFieldConfig(
    type,
    normalizeFieldConfigInput(type, shaped),
  );
  return {
    id: row.id,
    title: row.title,
    sortOrder: row.sortOrder,
    ownerEmail: row.ownerEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    type,
    config,
  } as FieldDefinition;
}

export function parseStoredValue(
  field: FieldDefinition,
  row: StoredCustomFieldValue,
): FieldValue | null {
  const shaped = parseFieldValueShape(JSON.parse(row.valueJson));
  if (isEmptyFieldValue(shaped)) return null;
  validateFieldValue(field, shaped);
  return normalizeFieldValue(field, shaped);
}
