// CDP TimeSinceEpoch payloads are seconds; diagnostics store epoch milliseconds.
export function cdpTimeSinceEpochMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 1000)
    : undefined;
}
