import { z } from "zod";

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/;
const SAFE_SOURCE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const GIT_REVISION = /^[a-f0-9]{7,64}$/i;
const SENSITIVE_TEXT =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|\{\{|\}\}|\b(?:bearer|api[_ -]?key|secret|password|token)\s*[:=]\s*\S+|\b\d{3}[-.\s)]?\d{3}[-.\s]?\d{4}\b|\b\d{13,19}\b)/i;
const SENSITIVE_TEXT_FIELDS = [
  "metric",
  "definition",
  "table",
  "columnsUsed",
  "dependencies",
  "joinPattern",
  "commonQuestions",
  "knownGotchas",
  "updateFrequency",
  "sourcePath",
] as const;
const sourceIndexSourceSchema = z
  .object({
    id: z.string().regex(SAFE_SOURCE),
    revision: z.string().regex(GIT_REVISION).optional(),
    contentFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
  })
  .strict()
  .refine(
    (source) => Boolean(source.revision || source.contentFingerprint),
    "Each source must include a repository revision or content fingerprint.",
  );
export const SOURCE_INDEX_SCOPES = [
  "analytics_user",
  "product_user",
  "person",
  "organization",
  "membership",
  "product_activity",
  "session",
  "crm_record",
  "unknown",
] as const;

export const sourceIndexEntrySchema = z
  .object({
    id: z.string().regex(SAFE_ID),
    metric: z.string().trim().min(1).max(200),
    definition: z.string().trim().min(1).max(5_000),
    source: z.string().regex(SAFE_SOURCE),
    semanticScope: z.enum(SOURCE_INDEX_SCOPES).optional(),
    table: z.string().trim().max(600).optional(),
    columnsUsed: z.string().trim().max(10_000).optional(),
    dependencies: z.string().trim().max(4_000).optional(),
    joinPattern: z.string().trim().max(4_000).optional(),
    commonQuestions: z.string().trim().max(2_000).optional(),
    knownGotchas: z.string().trim().max(4_000).optional(),
    updateFrequency: z.string().trim().max(200).optional(),
    sourcePath: z
      .string()
      .trim()
      .max(500)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          !path.startsWith("\\") &&
          !path.split(/[\\/]/).includes(".."),
        "sourcePath must be repository-relative",
      )
      .optional(),
    sourceRevision: z.string().regex(GIT_REVISION).optional(),
  })
  .strict();

export const sourceIndexBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso
      .datetime()
      .refine((value) => value.endsWith("Z"), "must be UTC ISO datetime"),
    sources: z.array(sourceIndexSourceSchema).min(1).max(10),
    entries: z.array(sourceIndexEntrySchema).min(1).max(1_500),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const ids = new Set<string>();
    for (const [index, entry] of bundle.entries.entries()) {
      if (ids.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "id"],
          message: `duplicate source index entry id: ${entry.id}`,
        });
      }
      ids.add(entry.id);
      for (const field of SENSITIVE_TEXT_FIELDS) {
        const value = entry[field];
        if (value && SENSITIVE_TEXT.test(value)) {
          ctx.addIssue({
            code: "custom",
            path: ["entries", index, field],
            message: "must not contain personal, secret, or URL-like text",
          });
        }
      }
    }

    const size = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
    if (size > 750_000) {
      ctx.addIssue({
        code: "custom",
        path: ["entries"],
        message: "source index bundle must be at most 750 KB",
      });
    }
  });

export type SourceIndexBundle = z.infer<typeof sourceIndexBundleSchema>;
export type SourceIndexEntry = z.infer<typeof sourceIndexEntrySchema>;

export function parseSourceIndexBundle(value: unknown): SourceIndexBundle {
  const parsed = sourceIndexBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Analytics source index is invalid: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
