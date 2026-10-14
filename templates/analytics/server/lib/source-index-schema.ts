import { z } from "zod";

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/;
const SAFE_SOURCE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const SAFE_COLUMN = /^[A-Za-z_][A-Za-z0-9_$-]{0,119}$/;
const GIT_REVISION = /^[a-f0-9]{7,64}$/i;
export const SOURCE_INDEX_KINDS = ["dbt", "code", "sigma"] as const;
export const SOURCE_INDEX_ENTRY_TYPES = [
  "model",
  "event",
  "semantic_model",
  "metric",
] as const;
const SENSITIVE_TEXT =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|\{\{|\}\}|\b(?:bearer|api[_ -]?key|secret|password|token)\s*[:=]\s*\S+|\b\d{3}[-.\s)]?\d{3}[-.\s]?\d{4}\b|\b\d{13,19}\b)/i;
const SENSITIVE_TEXT_FIELDS = [
  "metric",
  "definition",
  "table",
  "columnsUsed",
  "sqlProjectedColumns",
  "dependencies",
  "joinPattern",
  "commonQuestions",
  "knownGotchas",
  "updateFrequency",
  "sourcePath",
  "owner",
  "grain",
  "primaryEntity",
  "timeDimension",
  "semanticModel",
] as const;
const sourceIndexSourceSchema = z
  .object({
    id: z.string().regex(SAFE_SOURCE),
    sourceKind: z.enum(SOURCE_INDEX_KINDS).optional(),
    repositoryRef: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/)
      .optional(),
    revision: z.string().regex(GIT_REVISION).optional(),
    contentFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    generatedAt: z.iso
      .datetime()
      .refine((value) => value.endsWith("Z"), "must be UTC ISO datetime")
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
    sourceKind: z.enum(SOURCE_INDEX_KINDS).optional(),
    entryType: z.enum(SOURCE_INDEX_ENTRY_TYPES).optional(),
    status: z.enum(["active", "deprecated"]).default("active"),
    semanticScope: z.enum(SOURCE_INDEX_SCOPES).optional(),
    owner: z.string().trim().min(1).max(160).optional(),
    grain: z.string().trim().min(1).max(500).optional(),
    primaryEntity: z.string().trim().min(1).max(160).optional(),
    timeDimension: z.string().trim().min(1).max(160).optional(),
    semanticModel: z.string().trim().min(1).max(160).optional(),
    table: z.string().trim().max(600).optional(),
    columnsUsed: z.string().trim().max(10_000).optional(),
    sqlProjectedColumns: z.string().trim().max(10_000).optional(),
    inferredMembershipKeys: z
      .array(z.string().regex(SAFE_COLUMN))
      .min(2)
      .max(8)
      .optional(),
    inferredMembershipKeyRoles: z
      .object({
        user: z.string().regex(SAFE_COLUMN),
        organization: z.string().regex(SAFE_COLUMN),
      })
      .strict()
      .refine(
        ({ user, organization }) =>
          user.toLowerCase() !== organization.toLowerCase(),
        "membership identity columns must be distinct",
      )
      .optional(),
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
    scanSummary: z
      .object({
        unsafeEntriesOmitted: z.number().int().nonnegative(),
        unsafeFieldsOmitted: z.number().int().nonnegative(),
        truncatedFields: z.number().int().nonnegative(),
        unresolvedTrackingCallSites: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const sourcesById = new Map(
      bundle.sources.map((source) => [source.id, source]),
    );
    const seenSourceIds = new Set<string>();
    for (const [index, source] of bundle.sources.entries()) {
      if (seenSourceIds.has(source.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index, "id"],
          message: `duplicate source index source ID: ${source.id}`,
        });
      }
      seenSourceIds.add(source.id);
    }

    const ids = new Set<string>();
    for (const [index, entry] of bundle.entries.entries()) {
      const source = sourcesById.get(entry.source);
      if (!source) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "source"],
          message: `must reference a declared source: ${entry.source}`,
        });
      } else if (
        source.sourceKind &&
        entry.sourceKind &&
        source.sourceKind !== entry.sourceKind
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "sourceKind"],
          message: "must match the declared source kind",
        });
      }
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
      for (const column of entry.inferredMembershipKeys ?? []) {
        if (SENSITIVE_TEXT.test(column)) {
          ctx.addIssue({
            code: "custom",
            path: ["entries", index, "inferredMembershipKeys"],
            message: "must not contain personal, secret, or URL-like text",
          });
        }
      }
      if (entry.inferredMembershipKeyRoles) {
        const { user, organization } = entry.inferredMembershipKeyRoles;
        const membershipKeys = new Set(
          (entry.inferredMembershipKeys ?? []).map((column) =>
            column.toLowerCase(),
          ),
        );
        const projectedColumns = new Set(
          (entry.sqlProjectedColumns ?? "")
            .split(",")
            .map((column) => column.trim().toLowerCase())
            .filter(Boolean),
        );
        if (
          !membershipKeys.has(user.toLowerCase()) ||
          !membershipKeys.has(organization.toLowerCase()) ||
          !projectedColumns.has(user.toLowerCase()) ||
          !projectedColumns.has(organization.toLowerCase())
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["entries", index, "inferredMembershipKeyRoles"],
            message:
              "membership identity columns must be present in inferred and projected columns",
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
