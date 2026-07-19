import { z } from "zod";

export const sourceProviderSchema = z.enum([
  "manual",
  "generic",
  "clips",
  "slack",
  "granola",
  "github",
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
  sourceUrl: z.string().url().optional().describe("Optional source deeplink"),
  url: z.string().url().optional().describe("Deprecated alias for sourceUrl"),
  timestampMs: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Optional timestamp for meeting/call citations"),
});

const MAX_JSON_STRING_UNWRAPS = 2;

export function parseJsonCliInput(value: unknown) {
  if (value === undefined) return undefined;
  let parsed = value;
  for (let attempt = 0; attempt < MAX_JSON_STRING_UNWRAPS; attempt += 1) {
    if (typeof parsed !== "string") return parsed;
    const trimmed = parsed.trim();
    if (!trimmed) return undefined;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return parsed;
    }
  }
  return parsed;
}

export const jsonRecordSchema = z.preprocess(
  parseJsonCliInput,
  z.record(z.string(), z.unknown()).default({}),
);

export const optionalJsonRecordSchema = z
  .preprocess(parseJsonCliInput, z.record(z.string(), z.unknown()).optional())
  .optional();

export const booleanishSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

export function stringArrayCliSchema({
  min,
  max,
}: { min?: number; max?: number } = {}) {
  let schema = z.array(z.string().min(1));
  if (min !== undefined) schema = schema.min(min);
  if (max !== undefined) schema = schema.max(max);
  return z.preprocess((value) => {
    const parsed = parseJsonCliInput(value);
    if (typeof parsed === "string") {
      return parsed
        .split(/[\n,]/g)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return parsed;
  }, schema);
}

export const idSchema = z.string().min(1);
