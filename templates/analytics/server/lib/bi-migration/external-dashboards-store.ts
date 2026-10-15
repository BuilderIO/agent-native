import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../../db/index.js";

export const EXTERNAL_DASHBOARD_CLAIM_STALE_AFTER_MS = 10 * 60 * 1000;
export const EXTERNAL_DASHBOARD_DIAGNOSTIC_LIMIT = 20;

export const EXTERNAL_DASHBOARD_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS bi_migration_external_dashboards (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    provider VARCHAR(32) NOT NULL,
    source_id VARCHAR(200) NOT NULL,
    source_name VARCHAR(200),
    source_updated_at VARCHAR(64),
    status TEXT NOT NULL DEFAULT 'not_started',
    target_dashboard_id VARCHAR(200),
    original_migrator_email VARCHAR(320),
    migration_claimed_at TEXT,
    migration_claim_token VARCHAR(36),
    failure_code TEXT,
    provider_status INTEGER,
    element_diagnostics TEXT NOT NULL DEFAULT '[]',
    flagged_count INTEGER NOT NULL DEFAULT 0,
    migrated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    CONSTRAINT bi_migration_external_dashboards_status_check
      CHECK (status IN ('not_started', 'migrating', 'migrated', 'failed')),
    CONSTRAINT bi_migration_external_dashboards_failure_code_check
      CHECK (failure_code IS NULL OR failure_code IN ('provider_unavailable', 'unsupported_content', 'dashboard_write_failed', 'verification_failed', 'unknown')),
    CONSTRAINT bi_migration_external_dashboards_provider_status_check
      CHECK (provider_status IS NULL OR provider_status BETWEEN 100 AND 599),
    CONSTRAINT bi_migration_external_dashboards_element_diagnostics_length_check
      CHECK (char_length(element_diagnostics) <= 50000),
    CONSTRAINT bi_migration_external_dashboards_flagged_count_check
      CHECK (flagged_count >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bi_migration_external_dashboards_source_unique_idx
    ON bi_migration_external_dashboards (org_id, provider, source_id)`,
  `CREATE INDEX IF NOT EXISTS bi_migration_external_dashboards_org_status_updated_idx
    ON bi_migration_external_dashboards (org_id, status, updated_at)`,
];

export const EXTERNAL_DASHBOARD_FAILURE_CODES = [
  "provider_unavailable",
  "unsupported_content",
  "dashboard_write_failed",
  "verification_failed",
  "unknown",
] as const;

export const EXTERNAL_DASHBOARD_ELEMENT_REASONS = [
  "unsupported_visualization",
  "unsupported_filter",
  "unsupported_calculation",
  "query_unavailable",
  "manual_review_required",
  "other",
] as const;

const ProviderSchema = z.literal("sigma");
const SourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, "Sigma source IDs must be URL-safe identifiers.");

const ElementDiagnosticSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\u0000-\u001F\u007F]+$/),
    name: z.string().trim().min(1).max(200),
    status: z.enum(["red", "yellow"]),
    reason: z.enum(EXTERNAL_DASHBOARD_ELEMENT_REASONS),
  })
  .strict();

const SummarySchema = z.object({
  id: z.string(),
  provider: ProviderSchema,
  sourceId: SourceIdSchema,
  sourceName: z.string().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  status: z.enum(["not_started", "migrating", "migrated", "failed"]),
  targetDashboardId: z.string().nullable(),
  migratedByCurrentUser: z.boolean(),
  canRetryStaleClaim: z.boolean(),
  failureCode: z.enum(EXTERNAL_DASHBOARD_FAILURE_CODES).nullable(),
  providerStatus: z.number().nullable(),
  elementDiagnostics: z
    .array(ElementDiagnosticSchema)
    .max(EXTERNAL_DASHBOARD_DIAGNOSTIC_LIMIT),
  flaggedCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  migratedAt: z.string().nullable(),
});

const CreateSchema = z
  .object({
    provider: ProviderSchema,
    sourceId: SourceIdSchema,
    sourceName: z.string().trim().max(200).optional(),
    sourceUpdatedAt: z.string().trim().max(64).optional(),
  })
  .strict();

const ListSchema = z
  .object({
    provider: ProviderSchema.optional(),
    sourceIds: z.array(SourceIdSchema).max(100).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.sourceIds && !input.provider) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "provider is required when sourceIds are supplied.",
      });
    }
    if (
      input.sourceIds &&
      new Set(input.sourceIds).size !== input.sourceIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceIds"],
        message: "sourceIds must not contain duplicates.",
      });
    }
  });

const ClaimSchema = z
  .object({
    provider: ProviderSchema,
    sourceId: SourceIdSchema,
    remigrate: z.boolean().default(false),
  })
  .strict();

const CompleteSchema = z
  .object({
    provider: ProviderSchema,
    sourceId: SourceIdSchema,
    claimToken: z.string().uuid(),
    targetDashboardId: z.string().trim().min(1).max(200),
    elementDiagnostics: z
      .array(ElementDiagnosticSchema)
      .max(EXTERNAL_DASHBOARD_DIAGNOSTIC_LIMIT)
      .default([]),
    flaggedCount: z.number().int().min(0).max(1_000_000),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.flaggedCount < input.elementDiagnostics.length) {
      context.addIssue({
        code: "custom",
        path: ["flaggedCount"],
        message:
          "flaggedCount cannot be lower than the stored diagnostic count.",
      });
    }
  });

const FailSchema = z
  .object({
    provider: ProviderSchema,
    sourceId: SourceIdSchema,
    claimToken: z.string().uuid(),
    failureCode: z.enum(EXTERNAL_DASHBOARD_FAILURE_CODES),
    providerStatus: z.number().int().min(100).max(599).optional(),
    preservePreviousMigration: z.boolean().optional(),
  })
  .strict();

export type ExternalDashboardMigrationStatus =
  | "not_started"
  | "migrating"
  | "migrated"
  | "failed";
export type ExternalDashboardFailureCode =
  (typeof EXTERNAL_DASHBOARD_FAILURE_CODES)[number];
export type ExternalDashboardElementReason =
  (typeof EXTERNAL_DASHBOARD_ELEMENT_REASONS)[number];
export type ExternalDashboardElementDiagnostic = z.infer<
  typeof ElementDiagnosticSchema
>;
export type ExternalDashboardSummary = z.infer<typeof SummarySchema>;

type ExternalDashboardRow =
  typeof schema.externalDashboardMigrations.$inferSelect;

type ExternalDashboardContext = { orgId: string; userEmail: string };

export function boundExternalDashboardDiagnostics(
  diagnostics: ExternalDashboardElementDiagnostic[],
): {
  elementDiagnostics: ExternalDashboardElementDiagnostic[];
  flaggedCount: number;
} {
  return {
    elementDiagnostics: diagnostics.slice(
      0,
      EXTERNAL_DASHBOARD_DIAGNOSTIC_LIMIT,
    ),
    flaggedCount: diagnostics.length,
  };
}

function requireExternalDashboardContext(): ExternalDashboardContext {
  const userEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (!userEmail) {
    fail("An authenticated user is required to manage migrations.", {
      errorCode: "authentication_required",
      statusCode: 401,
    });
  }
  const orgId = getRequestOrgId()?.trim();
  if (!orgId) {
    fail("An active organization is required to manage migrations.", {
      errorCode: "organization_required",
      statusCode: 403,
    });
  }
  return { orgId, userEmail };
}

function toSummary(
  row: ExternalDashboardRow,
  userEmail: string,
): ExternalDashboardSummary {
  const migratedByCurrentUser =
    row.originalMigratorEmail?.trim().toLowerCase() === userEmail;
  const migrationClaimedAt = row.migrationClaimedAt
    ? Date.parse(row.migrationClaimedAt)
    : Number.NaN;
  const canRetryStaleClaim =
    row.status === "migrating" &&
    migratedByCurrentUser &&
    Number.isFinite(migrationClaimedAt) &&
    migrationClaimedAt <= Date.now() - EXTERNAL_DASHBOARD_CLAIM_STALE_AFTER_MS;
  return SummarySchema.parse({
    id: row.id,
    provider: row.provider,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    sourceUpdatedAt: row.sourceUpdatedAt,
    status: row.status,
    targetDashboardId: migratedByCurrentUser ? row.targetDashboardId : null,
    migratedByCurrentUser,
    canRetryStaleClaim,
    failureCode: row.failureCode,
    providerStatus: row.providerStatus,
    elementDiagnostics: JSON.parse(row.elementDiagnostics),
    flaggedCount: row.flaggedCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    migratedAt: row.migratedAt,
  });
}

export async function listExternalDashboards(
  input: {
    provider?: "sigma";
    sourceIds?: string[];
    limit?: number;
  } = {},
): Promise<ExternalDashboardSummary[]> {
  const parsed = ListSchema.parse(input);
  const { orgId, userEmail } = requireExternalDashboardContext();
  if (parsed.sourceIds?.length === 0) return [];

  const conditions = [eq(schema.externalDashboardMigrations.orgId, orgId)];
  if (parsed.provider) {
    conditions.push(
      eq(schema.externalDashboardMigrations.provider, parsed.provider),
    );
  }
  if (parsed.sourceIds) {
    conditions.push(
      inArray(schema.externalDashboardMigrations.sourceId, parsed.sourceIds),
    );
  }

  const rows = await getDb()
    .select()
    .from(schema.externalDashboardMigrations)
    .where(and(...conditions))
    .orderBy(desc(schema.externalDashboardMigrations.updatedAt))
    .limit(parsed.limit);
  return rows.map((row) => toSummary(row, userEmail));
}

export async function createExternalDashboard(input: {
  provider: "sigma";
  sourceId: string;
  sourceName?: string;
  sourceUpdatedAt?: string;
}): Promise<ExternalDashboardSummary> {
  const parsed = CreateSchema.parse(input);
  const { orgId, userEmail } = requireExternalDashboardContext();
  const now = new Date().toISOString();
  const sourceName = parsed.sourceName?.trim() || null;
  const sourceUpdatedAt = parsed.sourceUpdatedAt?.trim() || null;
  const metadataUpdates = {
    updatedAt: now,
    ...(sourceName !== null ? { sourceName } : {}),
    ...(sourceUpdatedAt !== null ? { sourceUpdatedAt } : {}),
  };

  const [row] = await getDb()
    .insert(schema.externalDashboardMigrations)
    .values({
      id: randomUUID(),
      orgId,
      provider: parsed.provider,
      sourceId: parsed.sourceId,
      sourceName,
      sourceUpdatedAt,
      status: "not_started",
      elementDiagnostics: "[]",
      flaggedCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.externalDashboardMigrations.orgId,
        schema.externalDashboardMigrations.provider,
        schema.externalDashboardMigrations.sourceId,
      ],
      set: metadataUpdates,
    })
    .returning();
  if (!row) {
    throw new Error(
      "External dashboard record was not returned after creation.",
    );
  }
  return toSummary(row, userEmail);
}

export type ExternalDashboardClaimResult =
  | {
      claimed: true;
      claimToken: string;
      record: ExternalDashboardSummary;
    }
  | {
      claimed: false;
      reason: "not_found" | "in_progress" | "already_migrated";
    };

export async function claimExternalDashboard(input: {
  provider: "sigma";
  sourceId: string;
  remigrate?: boolean;
}): Promise<ExternalDashboardClaimResult> {
  const parsed = ClaimSchema.parse(input);
  const { orgId, userEmail } = requireExternalDashboardContext();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(
    now.getTime() - EXTERNAL_DASHBOARD_CLAIM_STALE_AFTER_MS,
  ).toISOString();
  const claimToken = randomUUID();
  const table = schema.externalDashboardMigrations;
  const sameMigrator = eq(table.originalMigratorEmail, userEmail);
  const canStart = or(
    eq(table.status, "not_started"),
    eq(table.status, "failed"),
  );
  const canRecoverStaleClaim = and(
    eq(table.status, "migrating"),
    lt(table.migrationClaimedAt, staleBefore),
    sameMigrator,
  );
  const canRemigrate = parsed.remigrate
    ? and(eq(table.status, "migrated"), sameMigrator)
    : undefined;

  const [row] = await getDb()
    .update(table)
    .set({
      status: "migrating",
      originalMigratorEmail: userEmail,
      migrationClaimedAt: nowIso,
      migrationClaimToken: claimToken,
      failureCode: null,
      providerStatus: null,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(table.orgId, orgId),
        eq(table.provider, parsed.provider),
        eq(table.sourceId, parsed.sourceId),
        or(isNull(table.originalMigratorEmail), sameMigrator),
        or(canStart, canRecoverStaleClaim, canRemigrate),
      ),
    )
    .returning();

  if (row) {
    return { claimed: true, claimToken, record: toSummary(row, userEmail) };
  }

  const [existing] = await getDb()
    .select()
    .from(table)
    .where(
      and(
        eq(table.orgId, orgId),
        eq(table.provider, parsed.provider),
        eq(table.sourceId, parsed.sourceId),
      ),
    )
    .limit(1);
  if (!existing) return { claimed: false, reason: "not_found" };

  if (
    existing.originalMigratorEmail &&
    existing.originalMigratorEmail.toLowerCase() !== userEmail
  ) {
    fail("Only the original migrator may retry or remigrate this source.", {
      errorCode: "original_migrator_required",
      statusCode: 403,
    });
  }
  if (existing.status === "migrated") {
    return { claimed: false, reason: "already_migrated" };
  }
  return { claimed: false, reason: "in_progress" };
}

async function finishClaim(
  input: {
    provider: "sigma";
    sourceId: string;
    claimToken: string;
  },
  values: {
    status: "migrated" | "failed" | SQL<ExternalDashboardMigrationStatus>;
    updatedAt: string;
    migrationClaimedAt: null;
    migrationClaimToken: null;
    failureCode:
      | ExternalDashboardFailureCode
      | null
      | SQL<ExternalDashboardFailureCode | null>;
    providerStatus: number | null | SQL<number | null>;
    migratedAt: string | null | SQL<string | null>;
    targetDashboardId?: string;
    elementDiagnostics?: string;
    flaggedCount?: number;
    preservePreviousMigration?: boolean;
  },
): Promise<ExternalDashboardSummary> {
  const { orgId, userEmail } = requireExternalDashboardContext();
  const table = schema.externalDashboardMigrations;
  const { preservePreviousMigration, ...updates } = values;
  const keepPriorMigration = preservePreviousMigration
    ? sql`(${table.migratedAt} IS NOT NULL AND ${table.targetDashboardId} IS NOT NULL)`
    : null;
  const [row] = await getDb()
    .update(table)
    .set({
      ...updates,
      ...(keepPriorMigration
        ? {
            status: sql<ExternalDashboardMigrationStatus>`CASE WHEN ${keepPriorMigration} THEN 'migrated' ELSE 'failed' END`,
            failureCode: sql<ExternalDashboardFailureCode | null>`CASE WHEN ${keepPriorMigration} THEN NULL ELSE ${values.failureCode} END`,
            providerStatus: sql<
              number | null
            >`CASE WHEN ${keepPriorMigration} THEN NULL ELSE ${values.providerStatus}::integer END`,
            migratedAt: sql<
              string | null
            >`CASE WHEN ${keepPriorMigration} THEN ${table.migratedAt} ELSE NULL END`,
          }
        : {}),
    })
    .where(
      and(
        eq(table.orgId, orgId),
        eq(table.provider, input.provider),
        eq(table.sourceId, input.sourceId),
        eq(table.status, "migrating"),
        eq(table.originalMigratorEmail, userEmail),
        eq(table.migrationClaimToken, input.claimToken),
      ),
    )
    .returning();
  if (!row) {
    fail("The migration claim is no longer active.", {
      errorCode: "migration_claim_expired",
      statusCode: 409,
    });
  }
  return toSummary(row, userEmail);
}

export async function completeExternalDashboard(input: {
  provider: "sigma";
  sourceId: string;
  claimToken: string;
  targetDashboardId: string;
  elementDiagnostics?: ExternalDashboardElementDiagnostic[];
  flaggedCount: number;
}): Promise<ExternalDashboardSummary> {
  const parsed = CompleteSchema.parse(input);
  const now = new Date().toISOString();
  return finishClaim(parsed, {
    status: "migrated",
    targetDashboardId: parsed.targetDashboardId,
    elementDiagnostics: JSON.stringify(parsed.elementDiagnostics),
    flaggedCount: parsed.flaggedCount,
    updatedAt: now,
    migrationClaimedAt: null,
    migrationClaimToken: null,
    failureCode: null,
    providerStatus: null,
    migratedAt: now,
  });
}

export async function failExternalDashboard(input: {
  provider: "sigma";
  sourceId: string;
  claimToken: string;
  failureCode: ExternalDashboardFailureCode;
  providerStatus?: number;
  preservePreviousMigration?: boolean;
}): Promise<ExternalDashboardSummary> {
  const parsed = FailSchema.parse(input);
  return finishClaim(parsed, {
    status: "failed",
    updatedAt: new Date().toISOString(),
    migrationClaimedAt: null,
    migrationClaimToken: null,
    failureCode: parsed.failureCode,
    providerStatus: parsed.providerStatus ?? null,
    migratedAt: null,
    preservePreviousMigration: parsed.preservePreviousMigration,
  });
}
