// Runtime and Log timestamps are already milliseconds since the epoch.
export function cdpTimestampMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

// Network.wallTime is seconds since the epoch, unlike Runtime and Log timestamps.
export function cdpWallTimeMs(value: unknown): number | undefined {
  const seconds = cdpTimestampMs(value);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}
