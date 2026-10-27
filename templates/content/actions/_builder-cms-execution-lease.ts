export const BUILDER_EXECUTION_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export function builderExecutionStaleBefore(now: string) {
  const timestamp = Date.parse(now);
  return new Date(
    (Number.isFinite(timestamp) ? timestamp : Date.now()) -
      BUILDER_EXECUTION_CLAIM_TIMEOUT_MS,
  ).toISOString();
}

export function isBuilderExecutionClaimStale(updatedAt: string, now: string) {
  const updatedTimestamp = Date.parse(updatedAt);
  return (
    Number.isFinite(updatedTimestamp) &&
    updatedTimestamp < Date.parse(builderExecutionStaleBefore(now))
  );
}
