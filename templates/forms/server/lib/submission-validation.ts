import type { FormField } from "../../shared/types.js";

// Field value size limits by type. Keep public submissions bounded even when
// callers bypass the browser renderer and POST directly to /api/submit/:id.
const MAX_FIELD_LENGTH: Record<string, number> = {
  text: 1000,
  email: 1000,
  number: 1000,
  date: 1000,
  select: 1000,
  checkbox: 1000,
  radio: 1000,
  rating: 1000,
  scale: 1000,
  textarea: 10000,
  multiselect: 10000,
};

function fieldLabel(field: FormField): string {
  return field.label?.trim() || "Field";
}

function optionToString(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw == null) return null;
  if (typeof raw === "object") {
    const option = raw as { label?: unknown; value?: unknown };
    if (typeof option.label === "string") return option.label;
    if (typeof option.value === "string") return option.value;
    return "";
  }
  return String(raw);
}

function optionList(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of options) {
    const value = optionToString(raw);
    if (value == null) continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAbsentSubmissionValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function validatePattern(field: FormField, value: string): string | null {
  const pattern = field.validation?.pattern;
  if (!pattern) return null;
  try {
    if (!new RegExp(pattern).test(value)) {
      return field.validation?.message || `${fieldLabel(field)} is invalid`;
    }
  } catch {
    return `${fieldLabel(field)} has an invalid validation pattern`;
  }
  return null;
}

function validateText(
  field: FormField,
  value: unknown,
  typeName = "text",
): string | null {
  if (isAbsentSubmissionValue(value)) return null;
  if (typeof value !== "string") {
    return `${fieldLabel(field)} must be ${typeName}`;
  }
  const maxLen = MAX_FIELD_LENGTH[field.type] ?? 1000;
  if (value.length > maxLen) {
    return `${fieldLabel(field)} exceeds maximum length of ${maxLen} characters`;
  }
  return validatePattern(field, value);
}

function validateNumber(field: FormField, value: unknown): string | null {
  if (isAbsentSubmissionValue(value)) return null;
  const num = parseFiniteNumber(value);
  if (num === null) return `${fieldLabel(field)} must be a number`;
  const { min, max } = field.validation ?? {};
  if (min !== undefined && num < Number(min)) {
    return (
      field.validation?.message ||
      `${fieldLabel(field)} must be at least ${min}`
    );
  }
  if (max !== undefined && num > Number(max)) {
    return (
      field.validation?.message || `${fieldLabel(field)} must be at most ${max}`
    );
  }
  return null;
}

function validateDate(field: FormField, value: unknown): string | null {
  const textError = validateText(field, value, "a date");
  if (textError || isAbsentSubmissionValue(value)) return textError;
  const raw = value as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${fieldLabel(field)} must be a valid date`;
  }
  const [year, month, day] = raw.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return `${fieldLabel(field)} must be a valid date`;
  }
  return null;
}

function validateOption(field: FormField, value: unknown): string | null {
  const textError = validateText(field, value);
  if (textError || isAbsentSubmissionValue(value)) return textError;
  const options = optionList(field.options);
  if (!options.includes(value as string)) {
    return `${fieldLabel(field)} must match one of the available options`;
  }
  return null;
}

function validateMultiOption(field: FormField, value: unknown): string | null {
  if (isAbsentSubmissionValue(value)) return null;
  if (!Array.isArray(value)) {
    return `${fieldLabel(field)} must be a list of options`;
  }
  const options = optionList(field.options);
  const maxLen = MAX_FIELD_LENGTH.multiselect;
  for (const item of value) {
    if (typeof item !== "string") {
      return `${fieldLabel(field)} must be a list of text options`;
    }
    if (item.length > maxLen) {
      return `${fieldLabel(field)} contains a value exceeding maximum length`;
    }
    if (!options.includes(item)) {
      return `${fieldLabel(field)} contains an unavailable option`;
    }
  }
  return null;
}

function validateRating(field: FormField, value: unknown): string | null {
  if (isAbsentSubmissionValue(value)) return null;
  const num = parseFiniteNumber(value);
  if (num === null || !Number.isInteger(num) || num < 1 || num > 5) {
    return `${fieldLabel(field)} must be a rating from 1 to 5`;
  }
  return null;
}

function validateScale(field: FormField, value: unknown): string | null {
  if (isAbsentSubmissionValue(value)) return null;
  const num = parseFiniteNumber(value);
  const min = Number(field.validation?.min ?? 1);
  const max = Number(field.validation?.max ?? 10);
  if (num === null || !Number.isInteger(num)) {
    return `${fieldLabel(field)} must be a whole number`;
  }
  if (num < min) {
    return (
      field.validation?.message ||
      `${fieldLabel(field)} must be at least ${min}`
    );
  }
  if (num > max) {
    return (
      field.validation?.message || `${fieldLabel(field)} must be at most ${max}`
    );
  }
  return null;
}

export function isEmptySubmissionValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function validateSubmissionField(
  field: FormField,
  value: unknown,
): string | null {
  switch (field.type) {
    case "email": {
      const textError = validateText(field, value, "an email address");
      if (textError || isAbsentSubmissionValue(value)) return textError;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value as string)) {
        return `${fieldLabel(field)} must be a valid email address`;
      }
      return null;
    }
    case "number":
      return validateNumber(field, value);
    case "textarea":
      return validateText(field, value);
    case "select":
    case "radio":
      return validateOption(field, value);
    case "multiselect":
      return validateMultiOption(field, value);
    case "checkbox":
      return value === undefined || value === null || typeof value === "boolean"
        ? null
        : `${fieldLabel(field)} must be true or false`;
    case "date":
      return validateDate(field, value);
    case "rating":
      return validateRating(field, value);
    case "scale":
      return validateScale(field, value);
    case "text":
    default:
      return validateText(field, value);
  }
}
