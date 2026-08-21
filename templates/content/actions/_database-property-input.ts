import { ActionContractError } from "@agent-native/core";
import { z } from "zod";

export const databasePropertyValuesSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "Programmatic property values keyed by exact property definition ID.",
  );

export const databasePropertyEntriesSchema = z
  .array(
    z.object({
      propertyId: z
        .string()
        .min(1)
        .describe("Exact immutable property definition ID"),
      value: z.unknown().describe("Schema-valid value for this property"),
    }),
  )
  .max(1_000)
  .optional()
  .describe(
    "Property values as explicit entries. Include one entry for every schema-valid writable property value the user requested, using the exact immutable property definition ID. When at least one value was requested, never pass an empty array. Do not invent or clear unmentioned properties.",
  );

export function normalizeDatabasePropertyInput(input: {
  propertyEntries?: Array<{ propertyId: string; value: unknown }>;
  propertyValues?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  if (input.propertyEntries && input.propertyValues) {
    throw new ActionContractError(
      "Provide propertyEntries or propertyValues, not both.",
      { errorCode: "AMBIGUOUS_PROPERTY_INPUT" },
    );
  }
  if (!input.propertyEntries) return input.propertyValues;

  const values: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const entry of input.propertyEntries) {
    if (Object.prototype.hasOwnProperty.call(values, entry.propertyId)) {
      throw new ActionContractError(
        `Property entry ${entry.propertyId} was provided more than once.`,
        {
          errorCode: "DUPLICATE_PROPERTY_INPUT",
          details: { propertyId: entry.propertyId },
        },
      );
    }
    values[entry.propertyId] = entry.value;
  }
  return values;
}

export function canonicalizeDatabasePropertyInput<
  T extends {
    propertyEntries?: Array<{ propertyId: string; value: unknown }>;
    propertyValues?: Record<string, unknown>;
  },
>(
  input: T,
): Omit<T, "propertyEntries" | "propertyValues"> & {
  propertyValues?: Record<string, unknown>;
} {
  const { propertyEntries, propertyValues, ...canonicalInput } = input;
  return {
    ...canonicalInput,
    propertyValues: normalizeDatabasePropertyInput({
      propertyEntries,
      propertyValues,
    }),
  };
}
