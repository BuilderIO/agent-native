const UNSETTLED = Symbol("unsettled");

/**
 * What a take's upload target has settled to by the time capture starts, or
 * null when it is still resolving: capture never waits on storage. A target
 * that settles later is handed to `onLate`, so the row it opened is cleaned up.
 */
export async function uploadTargetAtStart<T>(
  target: Promise<T | null>,
  onLate: (late: T) => void,
): Promise<T | null> {
  const settled = await Promise.race([
    target,
    new Promise<typeof UNSETTLED>((resolve) =>
      setTimeout(() => resolve(UNSETTLED), 0),
    ),
  ]);
  if (settled !== UNSETTLED) return settled;
  void target.then(
    (late) => {
      if (late) onLate(late);
    },
    () => {
      // coercion-ok: a target that failed opened nothing to clean up.
    },
  );
  return null;
}
