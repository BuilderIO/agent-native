import type { z } from "zod";

/**
 * Stored-data failures are explicit. A value that is absent is `null`; a value
 * that is present but cannot be read is an error, never a silently skipped row
 * and never an apparently empty page.
 */
export class StoredDataError extends Error {
  readonly code = "analytics_unreadable_stored_data";
  readonly statusCode = 500;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StoredDataError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause });
    }
  }
}

/**
 * Serializes a cell's contents or a run output for storage.
 */
export function encodeJsonColumn(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Reads a serialized column. Missing/empty means the value was never written
 * (`null`); unparseable or schema-invalid text throws `StoredDataError` so the
 * caller returns a typed failure instead of dropping part of a project.
 */
export function decodeJsonColumn<T>(
  stored: string | null | undefined,
  schema: z.ZodType<T>,
): T | null {
  if (stored === null || stored === undefined || stored === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    throw new StoredDataError(
      "Stored workspace data could not be read. This record needs repair.",
      error,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StoredDataError(
      "Stored workspace data does not match the current schema. This record needs repair.",
      result.error,
    );
  }
  return result.data;
}
