// Restrict every persisted FormField id (and conditional.fieldId reference)
// to a safe character set. Field ids are interpolated into raw HTML attributes
// by the public form SSR renderer and into CSS/JS selectors by the inline
// runtime — an unrestricted id like `x" onfocus="alert(1)` would otherwise
// stored-XSS every anonymous submitter of a published form.
export const FIELD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONDITIONAL_OPERATORS = new Set(["equals", "not_equals", "contains"]);

/**
 * Generates a safe id for a whole-array field replacement (create-form,
 * update-form) when the model omits one — the #1 create-form failure in
 * the 2026-07-25 reliability sweep ("field #1 has an invalid id undefined").
 * Never used by patch-form-fields: there a missing id on an upsert op is
 * ambiguous (new field vs. a forgotten reference to an existing one), so it
 * must keep failing loud rather than risk silently creating a duplicate.
 * Ids are slugified from `label` through the same FIELD_ID_PATTERN charset
 * `assertValidFields` enforces, so a generated id can never fail that check.
 */
export function normalizeFieldIds(fields: unknown): unknown {
  if (!Array.isArray(fields)) return fields;
  const usedIds = new Set(
    fields
      .map((f) =>
        f && typeof f === "object" ? (f as Record<string, unknown>).id : null,
      )
      .filter(
        (id): id is string =>
          typeof id === "string" && FIELD_ID_PATTERN.test(id),
      ),
  );
  return fields.map((field) => {
    if (field == null || typeof field !== "object") return field;
    const f = field as Record<string, unknown>;
    if (typeof f.id === "string" && FIELD_ID_PATTERN.test(f.id)) return field;
    const label = typeof f.label === "string" ? f.label : "";
    const base =
      label
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "field";
    let candidate = base;
    let suffix = 1;
    while (usedIds.has(candidate)) {
      candidate = `${base}_${++suffix}`;
    }
    usedIds.add(candidate);
    return { ...f, id: candidate };
  });
}

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
