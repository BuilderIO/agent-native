import { useRef } from "react";

/**
 * Returns the record from an earlier render while its entries are unchanged,
 * so a prop read from an object that is rebuilt on every edit keeps its
 * identity and memoized children skip re-rendering.
 */
export function useStableRecord<T extends Record<string, unknown>>(
  record: T,
): T {
  const kept = useRef(record);
  if (!sameEntries(kept.current, record)) kept.current = record;
  return kept.current;
}

function sameEntries(a: Record<string, unknown>, b: Record<string, unknown>) {
  if (a === b) return true;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && Object.is(a[key], b[key]))
  );
}
