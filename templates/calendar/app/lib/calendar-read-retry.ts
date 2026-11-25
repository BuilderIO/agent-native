export function shouldRetryCalendarRead(
  count: number,
  error: unknown,
): boolean {
  return (
    count < 6 &&
    (error as { code?: string } | null)?.code === "calendar_rate_limited"
  );
}

export function calendarReadRetryDelay(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
}
