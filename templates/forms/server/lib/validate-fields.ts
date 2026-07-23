// Restrict every persisted FormField id (and conditional.fieldId reference)
// to a safe character set. Field ids are interpolated into raw HTML attributes
// by the public form SSR renderer and into CSS/JS selectors by the inline
// runtime — an unrestricted id like `x" onfocus="alert(1)` would otherwise
// stored-XSS every anonymous submitter of a published form.
export const FIELD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONDITIONAL_OPERATORS = new Set(["equals", "not_equals", "contains"]);

export function assertValidFields(fields: unknown): void {
  if (!Array.isArray(fields)) {
    throw new Error("fields must be an array");
  }
  const seenIds = new Set<string>();
  for (const [idx, field] of fields.entries()) {
    if (field == null || typeof field !== "object") {
      throw new Error(`field #${idx + 1} must be an object`);
    }
    const f = field as Record<string, unknown>;

    const id = f.id;
    if (typeof id !== "string" || !FIELD_ID_PATTERN.test(id)) {
      throw new Error(
        `field #${idx + 1} has an invalid id ${JSON.stringify(id)} — must match ${FIELD_ID_PATTERN.source}`,
      );
    }
    if (seenIds.has(id)) {
      throw new Error(`duplicate field id "${id}" at position #${idx + 1}`);
    }
    seenIds.add(id);

    const cond = f.conditional;
    if (cond !== undefined) {
      if (cond == null || typeof cond !== "object") {
        throw new Error(`field #${idx + 1} conditional must be an object`);
      }
      const condition = cond as Record<string, unknown>;
      const condFieldId = condition.fieldId;
      if (
        typeof condFieldId !== "string" ||
        !FIELD_ID_PATTERN.test(condFieldId)
      ) {
        throw new Error(
          `field #${idx + 1} conditional.fieldId ${JSON.stringify(condFieldId)} is invalid — must match ${FIELD_ID_PATTERN.source}`,
        );
      }
      if (
        typeof condition.operator !== "string" ||
        !CONDITIONAL_OPERATORS.has(condition.operator)
      ) {
        throw new Error(
          `field #${idx + 1} conditional.operator must be equals, not_equals, or contains`,
        );
      }
      if (typeof condition.value !== "string") {
        throw new Error(`field #${idx + 1} conditional.value must be a string`);
      }
    }

    // validation.min / .max are interpolated into HTML attributes (min="..."
    // max="...") by the SSR renderer — must be numeric to prevent XSS.
    const validation = f.validation;
    if (validation != null && typeof validation === "object") {
      const v = validation as Record<string, unknown>;
      if (v.min != null && !isFinite(Number(v.min))) {
        throw new Error(`field #${idx + 1} validation.min must be a number`);
      }
      if (v.max != null && !isFinite(Number(v.max))) {
        throw new Error(`field #${idx + 1} validation.max must be a number`);
      }
      if (v.pattern != null) {
        if (typeof v.pattern !== "string") {
          throw new Error(
            `field #${idx + 1} validation.pattern must be a string`,
          );
        }
        try {
          new RegExp(v.pattern);
        } catch {
          throw new Error(
            `field #${idx + 1} validation.pattern must be a valid regular expression`,
          );
        }
      }
    }
  }

  const fieldIndexes = new Map(
    fields.map((field, index) => [
      (field as Record<string, unknown>).id,
      index,
    ]),
  );
  for (const [idx, field] of fields.entries()) {
    const condition = (field as Record<string, unknown>).conditional;
    if (!condition || typeof condition !== "object") continue;
    const condFieldId = (condition as Record<string, unknown>).fieldId;
    const sourceIndex = fieldIndexes.get(condFieldId);
    if (sourceIndex === undefined) {
      throw new Error(
        `field #${idx + 1} conditional.fieldId ${JSON.stringify(condFieldId)} does not reference a field in this form`,
      );
    }
    if (sourceIndex >= idx) {
      throw new Error(
        `field #${idx + 1} conditional.fieldId must reference an earlier field`,
      );
    }
  }
}
