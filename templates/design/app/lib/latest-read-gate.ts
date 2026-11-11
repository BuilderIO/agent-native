/**
 * Overlapping async reads of one value can finish out of order. `begin` marks a
 * read as the newest; its result is current only while no later read began, so
 * an older read that finishes late is dropped instead of undoing a newer one.
 */
export function createLatestReadGate() {
  let newest = 0;
  return {
    begin(): () => boolean {
      newest += 1;
      const mine = newest;
      return () => mine === newest;
    },
  };
}
