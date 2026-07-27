import type { FormField } from "./types.js";

export function conditionalValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(conditionalValue).join(",");
  if (value === true) return "true";
  if (value === false) return "false";
  if (value == null) return "";
  return String(value);
}

export function isConditionalFieldVisible(
  field: Pick<FormField, "conditional">,
  values: Record<string, unknown>,
): boolean {
  const condition = field.conditional;
  if (!condition) return true;

  if (
    typeof condition.fieldId !== "string" ||
    typeof condition.value !== "string"
  ) {
    return false;
  }

  const rawValue = values[condition.fieldId];
  if (Array.isArray(rawValue)) {
    const selectedValues = rawValue.map(conditionalValue);
    switch (condition.operator) {
      case "equals":
        return (
          selectedValues.length === 1 && selectedValues[0] === condition.value
        );
      case "not_equals":
        return !selectedValues.includes(condition.value);
      case "contains":
        return selectedValues.includes(condition.value);
      default:
        return false;
    }
  }

  const currentValue = conditionalValue(rawValue);
  switch (condition.operator) {
    case "equals":
      return currentValue === condition.value;
    case "not_equals":
      return currentValue !== condition.value;
    case "contains":
      return currentValue.includes(condition.value);
    default:
      return false;
  }
}

export function sanitizeConditionalValues(
  fields: FormField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const visibleValues: Record<string, unknown> = {};
  for (const field of fields) {
    if (!isConditionalFieldVisible(field, visibleValues)) continue;
    if (Object.prototype.hasOwnProperty.call(values, field.id)) {
      visibleValues[field.id] = values[field.id];
    }
  }
  return visibleValues;
}
