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
    return (
      typeof patchFields.content === "string" &&
      typeof candidate.baseContentHash === "string" &&
      candidate.baseContentHash.length > 0 &&
      Object.keys(patchFields).every((field) => field === "content")
    );
  });
}
