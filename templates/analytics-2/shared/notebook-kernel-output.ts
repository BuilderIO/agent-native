import { z } from "zod";

import { resultIdSchema } from "./notebook-execution.js";

export const KERNEL_EXCEPTION_NAME_BYTES = 128;
export const KERNEL_ERROR_TEXT_BYTES = 8192;

const utf8 = new TextEncoder();
const boundedText = (limit: number) =>
  z.string().refine((value) => utf8.encode(value).byteLength <= limit);

export const kernelExceptionFields = {
  exceptionName: boundedText(KERNEL_EXCEPTION_NAME_BYTES).optional(),
  exceptionMessage: boundedText(KERNEL_ERROR_TEXT_BYTES).optional(),
};

export const kernelVariableSchema = z.strictObject({
  name: z.string().min(1).max(128),
  kind: z.enum(["dataframe", "scalar", "module", "function"]),
  type: z.string().min(1).max(128),
  preview: z.string().max(200).optional(),
  producerCellId: z.string().optional(),
});

export const kernelOutputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("stream"),
    channel: z.enum(["stdout", "stderr"]),
    text: z.string().max(262_144),
  }),
  z.strictObject({
    kind: z.literal("text"),
    data: z.string().max(262_144),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  }),
  z.strictObject({ kind: z.literal("table"), resultId: resultIdSchema }),
  z.strictObject({
    kind: z.literal("error"),
    trace: z.string().max(262_144),
    line: z.number().int().positive().nullable(),
    ...kernelExceptionFields,
  }),
]);

export type KernelVariable = z.infer<typeof kernelVariableSchema>;
export type KernelOutput = z.infer<typeof kernelOutputSchema>;
