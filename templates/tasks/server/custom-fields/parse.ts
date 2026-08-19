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
  let shaped: FieldValueInput;
  try {
    shaped = parseFieldValueShape(JSON.parse(row.valueJson));
  } catch {
    return null;
  }
  if (isEmptyFieldValue(shaped)) return null;

  const coerced = coerceStoredValueToConfig(field, shaped);
  if (coerced === null || isEmptyFieldValue(coerced)) return null;

  try {
    validateFieldValue(field, coerced);
  } catch {
    return null;
  }
  return normalizeFieldValue(field, coerced);
}

function roundToPrecision(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function coerceStoredValueToConfig(
  field: FieldDefinition,
  value: FieldValueInput,
): FieldValueInput | null {
  switch (field.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      const rounded = roundToPrecision(value, field.config.precision ?? 0);
      if (field.config.positiveOnly && rounded < 0) return null;
      return rounded;
    }
    case "percent":
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      return roundToPrecision(value, field.config.precision ?? 0);
    case "currency":
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      return roundToPrecision(value, field.config.precision ?? 2);
    case "single_select": {
      const allowed = field.config.options.some(
        (option) => option.id === value,
      );
      return allowed ? value : null;
    }
    case "multi_select": {
      if (!Array.isArray(value)) return null;
      const allowed = new Set(field.config.options.map((option) => option.id));
      return value.filter(
        (id): id is string => typeof id === "string" && allowed.has(id),
      );
    }
    default:
      return value;
  }
}
