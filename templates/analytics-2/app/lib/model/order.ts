/**
 * Ordering keys used to place cells inside a project.
 *
 * A cell's `order` is a short string compared with plain string ordering, so a
 * new cell can be placed between two neighbours without rewriting the rows
 * around it. Keys are made of the digits below and never end in the lowest
 * digit, which keeps a gap available on both sides of every key.
 *
 * An empty order means "not placed".
 */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/** The key a first cell gets, and what an empty list starts with. */
export const FIRST_ORDER_KEY = "i";

export class OrderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderKeyError";
  }
}

function digitAt(key: string, index: number): number | undefined {
  const digit = DIGITS.indexOf(key[index] ?? "");
  return digit < 0 ? undefined : digit;
}

/** A key is usable when it is non-empty, in the alphabet, and leaves room below. */
export function isValidOrderKey(key: string): boolean {
  if (key.length === 0) return false;
  if (!/^[0-9a-z]+$/.test(key)) return false;
  return !key.endsWith("0");
}

/** Plain codepoint comparison, the same order the column sorts in. */
export function compareOrder(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function assertUsableBounds(lower: string | null, upper: string | null): void {
  if (lower !== null && !isValidOrderKey(lower)) {
    throw new OrderKeyError(`Not a usable order key: ${JSON.stringify(lower)}`);
  }
  if (upper !== null && !isValidOrderKey(upper)) {
    throw new OrderKeyError(`Not a usable order key: ${JSON.stringify(upper)}`);
  }
  if (lower !== null && upper !== null && compareOrder(lower, upper) >= 0) {
    throw new OrderKeyError("Order keys must be strictly increasing");
  }
}

function midpoint(
  lower: string | null,
  upper: string | null,
  depth = 0,
): string {
  if (depth > 128) {
    throw new OrderKeyError("Order keys cannot be split any further");
  }
  if (upper !== null) {
    let shared = 0;
    while ((lower?.[shared] ?? "0") === upper[shared]) shared += 1;
    if (shared > 0) {
      return (
        upper.slice(0, shared) +
        midpoint(
          lower === null ? null : lower.slice(shared),
          upper.slice(shared),
          depth + 1,
        )
      );
    }
  }

  const lowerDigit = lower === null ? 0 : (digitAt(lower, 0) ?? 0);
  const upperDigit = upper === null ? BASE : (digitAt(upper, 0) ?? BASE);

  if (upperDigit - lowerDigit > 1) {
    const middle = Math.round((lowerDigit + upperDigit) / 2);
    return DIGITS[middle]!;
  }

  // The two digits are adjacent. Taking the upper key's first digit keeps the
  // result below it and above the lower key, and leaves room below.
  if (upper !== null && upper.length > 1) return upper.slice(0, 1);

  return (
    DIGITS[lowerDigit]! +
    midpoint(lower === null ? null : lower.slice(1), null, depth + 1)
  );
}

/**
 * A key strictly between `lower` and `upper`. `null` means unbounded on that
 * side. Passing keys that are out of order throws instead of silently
 * reordering the list.
 */
export function orderBetween(
  lower: string | null,
  upper: string | null,
): string {
  assertUsableBounds(lower, upper);
  const key = midpoint(lower, upper);
  if (!isValidOrderKey(key)) {
    throw new OrderKeyError("Generated an unusable order key");
  }
  if (lower !== null && compareOrder(key, lower) <= 0) {
    throw new OrderKeyError("Generated a key that is not above the lower key");
  }
  if (upper !== null && compareOrder(key, upper) >= 0) {
    throw new OrderKeyError("Generated a key that is not below the upper key");
  }
  return key;
}

/** The lowest order in the list, or null when the list has none. */
export function firstOrderKey(orders: readonly string[]): string | null {
  let first: string | null = null;
  for (const order of orders) {
    if (order.length === 0) continue;
    if (first === null || compareOrder(order, first) < 0) first = order;
  }
  return first;
}

/** The highest order in the list, or null when the list has none. */
export function lastOrderKey(orders: readonly string[]): string | null {
  let last: string | null = null;
  for (const order of orders) {
    if (order.length === 0) continue;
    if (last === null || compareOrder(order, last) > 0) last = order;
  }
  return last;
}

export function sortByOrder<T extends { order: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => compareOrder(a.order, b.order));
}

/**
 * A key for an item inserted at `position` among `orders`. `0` places it
 * first and `orders.length` places it last.
 */
export function orderForInsertion(
  orders: readonly string[],
  position: number,
): string {
  const sorted = orders.filter((order) => order.length > 0).sort(compareOrder);
  const clamped = Math.max(0, Math.min(position, sorted.length));
  if (sorted.length === 0) return FIRST_ORDER_KEY;
  const previous = clamped === 0 ? null : sorted[clamped - 1]!;
  const next = clamped === sorted.length ? null : sorted[clamped]!;
  return orderBetween(previous, next);
}
