const committedOutcomes = new WeakMap<object, { result: unknown }>();

/** Annotate only after a mutation commits; the thrown response remains an error. */
export function withCommittedActionAudit<T extends Error>(
  error: T,
  result: unknown,
): T {
  committedOutcomes.set(error, { result });
  return error;
}

export function committedActionAuditOutcome(error: unknown) {
  return error !== null && typeof error === "object"
    ? committedOutcomes.get(error)
    : undefined;
}
