export function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required test fixture value is missing");
  return value;
}
