import { z } from "zod";

import {
  attemptIdSchema,
  kernelGenerationSchema,
  namespaceIdSchema,
  runIdSchema,
} from "./notebook-execution.js";
import { kernelExceptionFields } from "./notebook-kernel-output.js";
import { completeResultManifestSchema } from "./notebook-result-contract.js";
import {
  absentSchema,
  decimalIntegerSchema,
  deniedSchema,
  unreadableSchema,
} from "./notebook-snapshot-contract.js";

export const CONTRACT_VERSION = 2;

const MAX_PARAMS = 128;
const MAX_PARAM_BYTES = 4096;
const encoder = new TextEncoder();
const kernelSqlParameterSchema = z.strictObject({
  type: z.enum([
    "STRING",
    "INT64",
    "FLOAT64",
    "NUMERIC",
    "BOOL",
    "DATE",
    "TIMESTAMP",
  ]),
  value: z
    .string()
    .refine((value) => encoder.encode(value).byteLength <= MAX_PARAM_BYTES)
    .nullable(),
});
export type KernelSqlParameter = z.infer<typeof kernelSqlParameterSchema>;

const kernelCursorSchema = decimalIntegerSchema.brand<"KernelEventCursor">();
const kernelArtifactIdSchema = z.string().min(1).brand<"KernelArtifactId">();
export const kernelEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_VERSION),
  namespaceId: namespaceIdSchema,
  generation: kernelGenerationSchema,
  commandId: z.string().min(1).brand<"KernelCommandId">(),
  runId: runIdSchema,
  attemptId: attemptIdSchema,
  resumeCursor: kernelCursorSchema.nullable(),
});

const kernelInputsSchema = z
  .array(
    z.strictObject({
      name: z.string().min(1),
      manifest: completeResultManifestSchema,
    }),
  )
  .max(32);

export const kernelCommandSchema = kernelEnvelopeSchema.extend({
  command: z.discriminatedUnion("operation", [
    z.strictObject({
      operation: z.enum(["open", "inspect", "interrupt", "restart", "close"]),
    }),
    z.strictObject({
      operation: z.literal("execute-python"),
      source: z.string(),
      inputs: kernelInputsSchema,
    }),
    z.strictObject({
      operation: z.literal("execute-dataframe-sql"),
      source: z.string(),
      inputs: kernelInputsSchema,
      params: z.array(kernelSqlParameterSchema).max(MAX_PARAMS),
    }),
  ]),
});

export const kernelAcknowledgementSchema = kernelEnvelopeSchema.extend({
  acknowledgement: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("accepted") }),
    absentSchema,
    unreadableSchema,
    deniedSchema,
    z.strictObject({
      status: z.literal("conflict"),
      reason: z.literal("command_id_reused"),
    }),
    z.strictObject({
      status: z.literal("stale"),
      reason: z.literal("stale_generation"),
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reason: z.enum([
        "unsupported_version",
        "quota_exceeded",
        "cursor_expired",
      ]),
    }),
  ]),
});

export const kernelEventSchema = kernelEnvelopeSchema.extend({
  sequence: kernelCursorSchema,
  event: z.discriminatedUnion("type", [
    z.strictObject({ type: z.enum(["queued", "ready"]) }),
    z.strictObject({
      type: z.literal("stream"),
      channel: z.enum(["stdout", "stderr"]),
      text: z.string(),
    }),
    z.strictObject({
      type: z.enum(["display", "result"]),
      artifactId: kernelArtifactIdSchema,
    }),
    z.strictObject({
      type: z.literal("error"),
      reason: z.literal("execution_failed"),
      trace: z.string(),
      line: z.number().int().positive().nullable(),
      ...kernelExceptionFields,
    }),
    z.strictObject({
      type: z.literal("terminal"),
      outcome: z.discriminatedUnion("status", [
        z.strictObject({ status: z.literal("complete") }),
        z.strictObject({
          status: z.literal("failed"),
          reason: z.enum([
            "execution_failed",
            "timeout",
            "memory_limit",
            "output_limit",
          ]),
        }),
        z.strictObject({
          status: z.literal("interrupted"),
          reason: z.enum([
            "interrupt_confirmed",
            "generation_closed",
            "execution_unknown",
          ]),
        }),
      ]),
    }),
  ]),
});

export type KernelEnvelope = z.infer<typeof kernelEnvelopeSchema>;
export type KernelCommand = z.infer<typeof kernelCommandSchema>;
export type KernelAcknowledgement = z.infer<typeof kernelAcknowledgementSchema>;
export type KernelEvent = z.infer<typeof kernelEventSchema>;
