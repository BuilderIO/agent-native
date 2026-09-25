import { ActionContractError } from "@agent-native/core";
import { z } from "zod";

const nullable = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.null()]);

const propertyIdSchema = z
  .string()
  .min(1)
  .describe("Exact immutable property definition ID");

const stringPropertyEntry = (
  propertyType: "text" | "place" | "phone" | "url" | "email",
  valueDescription: string,
) =>
  z
    .object({
      propertyId: propertyIdSchema,
      propertyType: z.literal(propertyType),
      value: nullable(z.string()).describe(valueDescription),
    })
    .strict();

const optionPropertyEntry = (propertyType: "select" | "status") =>
  z
    .object({
      propertyId: propertyIdSchema,
      propertyType: z.literal(propertyType),
      value: nullable(z.string()).describe(
        "Exact option ID or exact option label from the discovered property contract; null explicitly clears the value",
      ),
    })
    .strict();

export const databasePropertyEntrySchema = z.discriminatedUnion(
  "propertyType",
  [
    stringPropertyEntry("text", "Text value; null explicitly clears the value"),
    stringPropertyEntry(
      "place",
      "Place text; null explicitly clears the value",
    ),
    stringPropertyEntry(
      "phone",
      "Phone text; null explicitly clears the value",
    ),
    stringPropertyEntry(
      "url",
      "Absolute http/https URL; null explicitly clears the value",
    ),
    stringPropertyEntry(
      "email",
      "Email address; null explicitly clears the value",
    ),
    z
      .object({
        propertyId: propertyIdSchema,
        propertyType: z.literal("number"),
        value: nullable(z.number().finite()).describe(
          "Finite number; use a JSON number rather than numeric text, or null to explicitly clear",
        ),
      })
      .strict(),
    z
      .object({
        propertyId: propertyIdSchema,
        propertyType: z.literal("checkbox"),
        value: nullable(z.boolean()).describe(
          "Boolean; use true or false rather than text, or null to explicitly clear",
        ),
      })
      .strict(),
    optionPropertyEntry("select"),
    optionPropertyEntry("status"),
    z
      .object({
        propertyId: propertyIdSchema,
        propertyType: z.literal("multi_select"),
        value: nullable(z.array(z.string())).describe(
          "Option IDs or exact option labels from the discovered property contract; null explicitly clears the value",
        ),
      })
      .strict(),
    z
      .object({
        propertyId: propertyIdSchema,
        propertyType: z.literal("date"),
        value: nullable(
          z.union([
            z.string(),
            z
              .object({
                start: z.string(),
                end: z.string().optional(),
                includeTime: z.boolean().optional(),
              })
              .strict(),
          ]),
        ).describe(
          "ISO date/date-time string or { start, end?, includeTime? }; null explicitly clears the value",
        ),
      })
      .strict(),
    z
      .object({
        propertyId: propertyIdSchema,
        propertyType: z.literal("person"),
        value: nullable(z.array(z.string())).describe(
          "Person identifiers from the discovered property contract; null explicitly clears the value",
        ),
      })
      .strict(),
    z
      .object({
        propertyId: propertyIdSchema,
        propertyType: z.literal("files_media"),
        value: nullable(z.array(z.string())).describe(
          "Absolute http/https file URLs; null explicitly clears the value",
        ),
      })
      .strict(),
  ],
);

export type DatabasePropertyEntry = z.infer<typeof databasePropertyEntrySchema>;

export const databasePropertyValuesSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "Programmatic property values keyed by exact property definition ID.",
  );

export const databasePropertyEntriesSchema = z
  .array(databasePropertyEntrySchema)
  .min(1)
  .max(1_000)
  .optional()
  .describe(
    "Typed property values as explicit entries. Copy each propertyType from the discovered mutation contract and include one entry for every writable property value the user requested, using the exact immutable property definition ID. When at least one value was requested, never pass an empty array. Do not invent or clear unmentioned properties.",
  );

export function normalizeDatabasePropertyInput(input: {
  propertyEntries?: DatabasePropertyEntry[];
  propertyValues?: Record<string, unknown>;
}): {
  propertyValues: Record<string, unknown> | undefined;
  propertyTypeAssertions: Record<string, string> | undefined;
} {
  if (input.propertyEntries && input.propertyValues) {
    throw new ActionContractError(
      "Provide propertyEntries or propertyValues, not both.",
      { errorCode: "AMBIGUOUS_PROPERTY_INPUT" },
    );
  }
  if (!input.propertyEntries) {
    return {
      propertyValues: input.propertyValues,
      propertyTypeAssertions: undefined,
    };
  }

  const values: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const propertyTypes: Record<string, string> = Object.create(null) as Record<
    string,
    string
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
    propertyTypes[entry.propertyId] = entry.propertyType;
  }
  return {
    propertyValues: values,
    propertyTypeAssertions: propertyTypes,
  };
}

export function canonicalizeDatabasePropertyInput<
  T extends {
    propertyEntries?: DatabasePropertyEntry[];
    propertyValues?: Record<string, unknown>;
  },
>(
  input: T,
): Omit<T, "propertyEntries" | "propertyValues"> & {
  propertyValues?: Record<string, unknown>;
  propertyTypeAssertions?: Record<string, string>;
} {
  const { propertyEntries, propertyValues, ...canonicalInput } = input;
  const normalized = normalizeDatabasePropertyInput({
    propertyEntries,
    propertyValues,
  });
  return {
    ...canonicalInput,
    propertyValues: normalized.propertyValues,
    propertyTypeAssertions: normalized.propertyTypeAssertions,
  };
}
