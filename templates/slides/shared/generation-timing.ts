export function generationTimingFields(
  startedAt: number | undefined,
  endedAt: number,
): {
  started_at_ms?: number;
  ended_at_ms: number;
  duration_ms?: number;
  duration_error?: "clock_skew";
} {
  if (startedAt === undefined) return { ended_at_ms: endedAt };
  const durationMs = endedAt - startedAt;
  return {
    started_at_ms: startedAt,
    ended_at_ms: endedAt,
    ...(durationMs >= 0
      ? { duration_ms: durationMs }
      : { duration_error: "clock_skew" }),
  };
}
