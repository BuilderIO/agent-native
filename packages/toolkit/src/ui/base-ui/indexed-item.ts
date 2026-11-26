/** Ordinary (non-wrapping) indexing for positions that can fall outside a list. */
export function indexedItem<T>(
  items: readonly T[],
  index: number,
): T | undefined {
  return items[index];
}

export function requireItem<T>(items: readonly T[], index: number): T {
  const value = indexedItem(items, index);
  if (value === undefined)
    throw new RangeError("Missing item at index " + index);
  return value;
}
