/**
 * Time source for store writes.
 *
 * Records need a timestamp; tests need the same timestamp twice. `nowIso` is
 * the only place the clock is read, so a test can pin it with `withFixedClock`
 * instead of asserting on a moving value.
 */
let fixedIso: string | null = null;

export function nowIso(): string {
  return fixedIso ?? new Date().toISOString();
}

export async function withFixedClock<T>(
  iso: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = fixedIso;
  fixedIso = iso;
  try {
    return await run();
  } finally {
    fixedIso = previous;
  }
}
