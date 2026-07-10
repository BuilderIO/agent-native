import { z } from "zod";
import { FIELD_TYPES, SELECT_COLOR_TOKENS } from "./types.js";

/** Parse JSON-string action args before Zod validation. */
export function parseJsonArg(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed);
}

export const fieldTypeSchema = z.enum(FIELD_TYPES);
export const selectColorSchema = z.enum(SELECT_COLOR_TOKENS);

export const emptyConfigShapeSchema = z.object({}).strict();
export const numericConfigShapeSchema = z
  .object({
    precision: z.number().optional(),
    positiveOnly: z.boolean().optional(),
  })
  .strict();
export const percentConfigShapeSchema = z
  .object({
    precision: z.number().optional(),
  })
  .strict();
export const currencyConfigShapeSchema = z
  .object({
    symbol: z.string().optional(),
    precision: z.number().optional(),
  })
  .strict();
export const selectOptionShapeSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    color: selectColorSchema.optional(),
    sortOrder: z.number().optional(),
  })
  .strict();
export const selectConfigShapeSchema = z
  .object({
    options: z.array(selectOptionShapeSchema).optional(),
  })
  .strict();
export const fieldConfigShapeSchema = z.union([
  selectConfigShapeSchema,
  currencyConfigShapeSchema,
  numericConfigShapeSchema,
  percentConfigShapeSchema,
  emptyConfigShapeSchema,
]);
export const fieldValueInputSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.null(),
]);

export type {
  CurrencyConfigInput,
  EmptyConfigInput,
  FieldConfigInput,
  NumericConfigInput,
  PercentConfigInput,
  SelectConfigInput,
  SelectOptionInput,
} from "./types.js";

function configArg<T extends z.ZodType>(schema: T) {
  return z.preprocess(parseJsonArg, schema).optional();
}

const titleShapeSchema = z.string().describe("Field title");

export const createCustomFieldActionSchema = z.discriminatedUnion("type", [
  z.object({
    title: titleShapeSchema,
    type: z.literal("text"),
    config: configArg(emptyConfigShapeSchema),
  }),
  z.object({
    title: titleShapeSchema,
    type: z.literal("rich_text"),
    config: configArg(emptyConfigShapeSchema),
  }),
  z.object({
    title: titleShapeSchema,
    type: z.literal("date"),
    config: configArg(emptyConfigShapeSchema),
  }),
  z.object({
    title: titleShapeSchema,
    type: z.literal("number"),
    config: configArg(numericConfigShapeSchema),
  }),
  z.object({
    title: titleShapeSchema,
    type: z.literal("percent"),
    config: configArg(percentConfigShapeSchema),
  }),
  z.object({
    title: titleShapeSchema,
    type: z.literal("currency"),
    config: configArg(currencyConfigShapeSchema),
  }),
  z.object({
    title: titleShapeSchema,
    type: z.literal("single_select"),
    config: configArg(selectConfigShapeSchema),
  }),
  z.object({
    title: titleShapeSchema,
    type: z.literal("multi_select"),
    config: configArg(selectConfigShapeSchema),
  }),
]);

export const updateCustomFieldConfigActionSchema = z.preprocess(
  parseJsonArg,
  z.unknown(),
);
