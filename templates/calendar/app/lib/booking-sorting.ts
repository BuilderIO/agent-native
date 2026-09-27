export function sortBookingsNewestFirst<T extends { start: string }>(
  bookings: readonly T[],
): T[] {
  return [...bookings].sort(
    (a, b) => Date.parse(b.start) - Date.parse(a.start),
  );
}
