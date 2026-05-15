import { z } from "zod";

export const sourceProviderSchema = z.enum([
  "manual",
  "generic",
  "clips",
  "slack",
  "granola",
]);

export const captureKindSchema = z.enum([
  "transcript",
  "note",
  "message",
  "document",
  "generic",
]);

export const publishTierSchema = z.enum(["private", "team", "company"]);

export const knowledgeKindSchema = z.enum([
  "decision",
  "rationale",
  "how-it-works",
  "fact",
  "open-question",
  "process",
  "risk",
  "policy",
]);

export const entitySchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
});

export const evidenceSchema = z.object({
  captureId: z.string().min(1).describe("Capture that contains the quote"),
  quote: z.string().min(1).describe("Exact substring from the capture content"),
  note: z.string().optional().describe("Optional note about why this matters"),
  url: z.string().url().optional().describe("Optional source deeplink"),
  timestampMs: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Optional timestamp for meeting/call citations"),
});

export const jsonRecordSchema = z.record(z.string(), z.unknown()).default({});

export const optionalJsonRecordSchema = z
  .record(z.string(), z.unknown())
  .optional();

export const idSchema = z.string().min(1);
