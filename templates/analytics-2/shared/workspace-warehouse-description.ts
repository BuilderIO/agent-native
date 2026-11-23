// Configuration strings are normalized by the native credential service.
// JSON encoding retains intentional whitespace and represents an empty value.
export function readWorkspaceWarehouseDescription(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Invalid warehouse description.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("Invalid warehouse description.");
  }
  if (typeof decoded !== "string" || decoded.length > 4000)
    throw new Error("Invalid warehouse description.");
  return decoded;
}
