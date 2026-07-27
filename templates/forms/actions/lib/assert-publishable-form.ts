import type { FormField } from "../../shared/types.js";

/** Reject forms that would be unusable if published. */
export function assertPublishableForm(fields: FormField[]): void {
  const issues: string[] = [];
  if (fields.length === 0) {
    issues.push("form has no fields");
  }

  const optionTypes = new Set(["select", "multiselect", "radio"]);
  for (const [index, field] of fields.entries()) {
    const label = String(field?.label ?? "").trim();
    if (!label) {
      issues.push(`field #${index + 1} is missing a label`);
    }
    if (
      optionTypes.has(field?.type) &&
      (!Array.isArray(field?.options) || field.options.length === 0)
    ) {
      issues.push(`field "${label || `#${index + 1}`}" has no options`);
    }
    if (
      field?.required &&
      (field.type === "number" || field.type === "scale") &&
      field.validation?.min !== undefined &&
      field.validation?.max !== undefined &&
      Number(field.validation.min) > Number(field.validation.max)
    ) {
      issues.push(`required field "${label || `#${index + 1}`}" has min > max`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `Cannot publish: ${issues.join("; ")}. Fix these before publishing.`,
    );
  }
}
