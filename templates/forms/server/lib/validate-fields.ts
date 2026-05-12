// Restrict every persisted FormField id (and conditional.fieldId reference)
// to a safe character set. Field ids are interpolated into raw HTML attributes
// by the public form SSR renderer and into CSS/JS selectors by the inline
// runtime — an unrestricted id like `x" onfocus="alert(1)` would otherwise
// stored-XSS every anonymous submitter of a published form.
export const FIELD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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
    if (cond && typeof cond === "object") {
      const condFieldId = (cond as Record<string, unknown>).fieldId;
      if (condFieldId !== undefined) {
        if (
          typeof condFieldId !== "string" ||
          !FIELD_ID_PATTERN.test(condFieldId)
        ) {
          throw new Error(
            `field #${idx + 1} conditional.fieldId ${JSON.stringify(condFieldId)} is invalid — must match ${FIELD_ID_PATTERN.source}`,
          );
        }
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
    }
  }
}
