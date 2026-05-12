import type { FormField, FormFieldType } from "@shared/types";

// Single source of truth for coercing FormField[] coming back from the API
// into a renderable shape. Both the agent and the UI can write arbitrary
// JSON into form.fields — this helper protects every React consumer from:
//   - missing/object/numeric `type` (defaults to "text" rather than dropping
//     the field, so the user doesn't silently lose data)
//   - `options` being a non-array, or an array of {label,value} objects /
//     numbers / blanks / duplicates (any of which would crash a downstream
//     `.map()` or render duplicate React keys)
// FieldRenderer keeps its own `dedupeRenderableOptions` for the *builder*
// preview where the user is mid-typing — that handles transient live-edit
// state, not stored data.
const KNOWN_FIELD_TYPES: FormFieldType[] = [
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
  return String(raw);
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
