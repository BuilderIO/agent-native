export type SlideFieldBaseline =
  | { present: false }
  | { present: true; value: unknown };

export function isMergeSafeDeckPatchOperations(operations: unknown): boolean {
  if (!Array.isArray(operations) || operations.length === 0) return false;

  return operations.every((operation) => {
    if (!operation || typeof operation !== "object") return false;
    const candidate = operation as Record<string, unknown>;
    if (candidate.op === "add-slide") return true;
    if (candidate.op !== "patch-slide") return false;

    const fields = candidate.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return false;
    }
    const patchFields = fields as Record<string, unknown>;
    const hasContent = patchFields.content !== undefined;
    if (
      hasContent &&
      (typeof patchFields.content !== "string" ||
        typeof candidate.baseContentHash !== "string" ||
        candidate.baseContentHash.length === 0)
    ) {
      return false;
    }

    const nonContentFields = Object.keys(patchFields).filter(
      (field) => field !== "content" && patchFields[field] !== undefined,
    );
    if (nonContentFields.length === 0) return hasContent;

    const baselines = candidate.baseFields;
    if (
      !baselines ||
      typeof baselines !== "object" ||
      Array.isArray(baselines)
    ) {
      return false;
    }
    const baselineFields = baselines as Record<string, unknown>;
    return nonContentFields.every((field) => {
      const baseline = baselineFields[field];
      if (
        !baseline ||
        typeof baseline !== "object" ||
        Array.isArray(baseline)
      ) {
        return false;
      }
      const snapshot = baseline as Record<string, unknown>;
      return (
        snapshot.present === false ||
        (snapshot.present === true && Object.hasOwn(snapshot, "value"))
      );
    });
  });
}
