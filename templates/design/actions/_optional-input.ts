import type { z } from "zod";

/**
 * An optional action field where `null` means "not provided", never "clear".
 * Models pad unused fields with null; a field that rejects null makes core
 * refuse the call when valid empty values sit beside it.
 */
export function optionalInput<T extends z.ZodType>(
  field: T,
): z.ZodPipe<
  z.ZodOptional<z.ZodNullable<T>>,
  z.ZodTransform<z.output<T> | undefined>
>;
export function optionalInput<T extends z.ZodType>(
  field: T,
  fallback: z.output<T>,
): z.ZodPipe<z.ZodOptional<z.ZodNullable<T>>, z.ZodTransform<z.output<T>>>;
export function optionalInput<T extends z.ZodType>(
  field: T,
  fallback?: z.output<T>,
) {
  return field
    .nullable()
    .optional()
    .transform((value) => value ?? fallback);
}
