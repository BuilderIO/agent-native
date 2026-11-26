/**
 * `values[index]`, or a RangeError. Token tables are fixed-length; a missing
 * step is a bug, and returning undefined would print "undefinedpx" into CSS.
 */
export function at<T>(values: ArrayLike<T>, index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(
      `Index ${index} is out of range for a table of ${values.length}`,
    );
  }
  return value;
}
