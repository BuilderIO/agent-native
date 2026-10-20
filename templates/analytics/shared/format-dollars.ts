/** Sign goes before the symbol: -$7,505, never $-7,505. */
export function formatDollars(value: number): string {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString()}`;
}
