import type { FormField, FormFieldType } from "@shared/types";

import type { AppFormFieldType } from "@/lib/form-field-types";

const KNOWN_FIELD_TYPES: AppFormFieldType[] = [
  "text",
  "email",
  "number",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "radio",
  "date",
  "rating",
  "scale",
  "file",
];

function coerceOptionToString(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw == null) return null;
  if (typeof raw === "object") {
    const v = raw as { label?: unknown; value?: unknown };
    if (typeof v.label === "string") return v.label;
    if (typeof v.value === "string") return v.value;
    return "";
  }
  if (
    typeof raw === "number" ||
    typeof raw === "boolean" ||
    typeof raw === "bigint" ||
    typeof raw === "symbol"
  ) {
    return String(raw);
  }
  return JSON.stringify(raw);
}

export function normalizeFields(fields: FormField[] | undefined): FormField[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => {
    const type: FormFieldType =
      typeof field?.type === "string" &&
      (KNOWN_FIELD_TYPES as string[]).includes(field.type)
        ? (field.type as FormFieldType)
        : "text";
    const out: FormField = { ...field, type };
    if (field?.options !== undefined) {
      const rawList = Array.isArray(field.options) ? field.options : [];
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of rawList) {
        const str = coerceOptionToString(raw);
        if (str == null) continue;
        const trimmed = str.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        cleaned.push(trimmed);
      }
      out.options = cleaned;
    }
    return out;
  });
}
