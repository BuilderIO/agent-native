import {
  getDbExec,
  getDialect,
  isPostgres,
  retryOnDdlRace,
  type DbExec,
  type DbExecStatement,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

export type AutomationSharingVisibility = "private" | "organization";
export type AutomationSharingGrantRole = "view" | "collaborate";

export interface AutomationSharingGrantInput {
  email: string;
  role: AutomationSharingGrantRole;
}

export type CompleteAutomationSharingState =
  | {
      kind: "personal";
    }
  | {
      kind: "organization";
      organizationId: string;
    }
  | {
      kind: "specific";
      organizationId?: string | null;
      grants: readonly AutomationSharingGrantInput[];
    };

export interface AutomationSharingOverlayRow {
  resourceId: string;
  visibility: AutomationSharingVisibility;
  organizationId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationSharingGrantRow {
  resourceId: string;
  email: string;
  role: AutomationSharingGrantRole;
  createdAt: number;
  updatedAt: number;
}

export type AutomationSharingSummary =
  | {
      resourceId: string;
      kind: "personal";
      visibility: "private";
      organizationId: null;
      grants: [];
    }
  | {
      resourceId: string;
      kind: "organization";
      visibility: "organization";
      organizationId: string;
      grants: [];
    }
  | {
      resourceId: string;
      kind: "specific";
      visibility: "private";
      organizationId: string | null;
      grants: AutomationSharingGrantRow[];
    };

const OVERLAYS_TABLE = "automation_sharing_overlays";
const GRANTS_TABLE = "automation_sharing_grants";
const READ_BATCH_SIZE = 200;

let initPromise: Promise<void> | undefined;

function normalizedRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function normalizeAutomationSharingEmail(email: string): string {
  return normalizedRequired(email, "Sharing grant email").toLowerCase();
}

function normalizeCompleteState(input: CompleteAutomationSharingState): {
  visibility: AutomationSharingVisibility;
  organizationId: string | null;
  grants: AutomationSharingGrantInput[];
} {
  if (input.kind === "personal") {
    return { visibility: "private", organizationId: null, grants: [] };
  }
  if (input.kind === "organization") {
    return {
      visibility: "organization",
      organizationId: normalizedRequired(
        input.organizationId,
        "Organization id",
      ),
      grants: [],
    };
  }
  if (input.kind !== "specific") {
    throw new Error("Unsupported automation sharing state.");
  }

  const grants = new Map<string, AutomationSharingGrantRole>();
  for (const grant of input.grants) {
    if (grant.role !== "view" && grant.role !== "collaborate") {
      throw new Error("Sharing grant role must be view or collaborate.");
    }
    grants.set(normalizeAutomationSharingEmail(grant.email), grant.role);
  }
  if (grants.size === 0) {
    throw new Error("Specific sharing requires at least one grant.");
  }

  return {
    visibility: "private",
    organizationId: input.organizationId?.trim() || null,
    grants: [...grants].map(([email, role]) => ({ email, role })),
  };
}

function overlayFromRow(
  row: Record<string, unknown>,
): AutomationSharingOverlayRow {
  const visibility = String(row.visibility);
  if (visibility !== "private" && visibility !== "organization") {
    throw new Error(
      `Invalid stored automation sharing visibility: ${visibility}`,
    );
  }
  return {
    resourceId: String(row.resource_id),
    visibility,
    organizationId:
      row.organization_id == null ? null : String(row.organization_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function grantFromRow(row: Record<string, unknown>): AutomationSharingGrantRow {
  const role = String(row.role);
  if (role !== "view" && role !== "collaborate") {
    throw new Error(`Invalid stored automation sharing grant role: ${role}`);
  }
  return {
    resourceId: String(row.resource_id),
    email: normalizeAutomationSharingEmail(String(row.user_email)),
    role,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function ensureTables(): Promise<void> {
  const client = getDbExec();
  const createOverlaysSql = `
    CREATE TABLE IF NOT EXISTS ${OVERLAYS_TABLE} (
      resource_id TEXT PRIMARY KEY,
      visibility TEXT NOT NULL,
      organization_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      CHECK (visibility IN ('private', 'organization'))
    )
  `;
  const createGrantsSql = `
    CREATE TABLE IF NOT EXISTS ${GRANTS_TABLE} (
      resource_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (resource_id, user_email),
      CHECK (role IN ('view', 'collaborate'))
    )
  `;
  const organizationIndexSql = `CREATE INDEX IF NOT EXISTS idx_automation_sharing_overlays_organization ON ${OVERLAYS_TABLE} (organization_id, visibility, resource_id)`;
  const userGrantIndexSql = `CREATE INDEX IF NOT EXISTS idx_automation_sharing_grants_user ON ${GRANTS_TABLE} (user_email, resource_id)`;

  if (isPostgres()) {
    await ensureTableExists(OVERLAYS_TABLE, createOverlaysSql);
    await ensureTableExists(GRANTS_TABLE, createGrantsSql);
    await ensureIndexExists(
      "idx_automation_sharing_overlays_organization",
      organizationIndexSql,
    );
    await ensureIndexExists(
      "idx_automation_sharing_grants_user",
      userGrantIndexSql,
    );
    return;
  }

  await retryOnDdlRace(() => client.execute(createOverlaysSql));
  await retryOnDdlRace(() => client.execute(createGrantsSql));
  await retryOnDdlRace(() => client.execute(organizationIndexSql));
  await retryOnDdlRace(() => client.execute(userGrantIndexSql));
}

export async function ensureAutomationSharingTables(): Promise<void> {
  if (!initPromise) {
    initPromise = ensureTables().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  await initPromise;
}

export async function loadAutomationSharingOverlays(
  resourceIds: readonly string[],
  client: DbExec = getDbExec(),
): Promise<Map<string, AutomationSharingOverlayRow>> {
  await ensureAutomationSharingTables();
  const ids = [...new Set(resourceIds.map((id) => id.trim()).filter(Boolean))];
  const overlays = new Map<string, AutomationSharingOverlayRow>();
  for (const batch of chunks(ids, READ_BATCH_SIZE)) {
    const result = await client.execute({
      sql: `SELECT resource_id, visibility, organization_id, created_at, updated_at FROM ${OVERLAYS_TABLE} WHERE resource_id IN (${batch.map(() => "?").join(", ")})`,
      args: batch,
    });
    for (const rawRow of result.rows) {
      const row = overlayFromRow(rawRow as Record<string, unknown>);
      overlays.set(row.resourceId, row);
    }
  }
  return overlays;
}

export async function loadAutomationSharingGrants(
  resourceIds: readonly string[],
  client: DbExec = getDbExec(),
): Promise<Map<string, AutomationSharingGrantRow[]>> {
  await ensureAutomationSharingTables();
  const ids = [...new Set(resourceIds.map((id) => id.trim()).filter(Boolean))];
  const grants = new Map<string, AutomationSharingGrantRow[]>();
  for (const batch of chunks(ids, READ_BATCH_SIZE)) {
    const result = await client.execute({
      sql: `SELECT resource_id, user_email, role, created_at, updated_at FROM ${GRANTS_TABLE} WHERE resource_id IN (${batch.map(() => "?").join(", ")}) ORDER BY resource_id, user_email`,
      args: batch,
    });
    for (const rawRow of result.rows) {
      const row = grantFromRow(rawRow as Record<string, unknown>);
      const rows = grants.get(row.resourceId) ?? [];
      rows.push(row);
      grants.set(row.resourceId, rows);
    }
  }
  return grants;
}

export async function loadAutomationSharingStates(
  resourceIds: readonly string[],
  client: DbExec = getDbExec(),
): Promise<Map<string, AutomationSharingSummary>> {
  const [overlays, grantsByResource] = await Promise.all([
    loadAutomationSharingOverlays(resourceIds, client),
    loadAutomationSharingGrants(resourceIds, client),
  ]);
  const states = new Map<string, AutomationSharingSummary>();
  for (const [resourceId, overlay] of overlays) {
    const grants = grantsByResource.get(resourceId) ?? [];
    if (overlay.visibility === "organization") {
      if (!overlay.organizationId) {
        throw new Error(
          `Organization-visible automation ${resourceId} has no organization id.`,
        );
      }
      states.set(resourceId, {
        resourceId,
        kind: "organization",
        visibility: "organization",
        organizationId: overlay.organizationId,
        grants: [],
      });
    } else if (grants.length > 0) {
      states.set(resourceId, {
        resourceId,
        kind: "specific",
        visibility: "private",
        organizationId: overlay.organizationId,
        grants,
      });
    } else {
      states.set(resourceId, {
        resourceId,
        kind: "personal",
        visibility: "private",
        organizationId: null,
        grants: [],
      });
    }
  }
  return states;
}

export async function getAutomationSharingState(
  resourceId: string,
  client: DbExec = getDbExec(),
): Promise<AutomationSharingSummary | null> {
  const states = await loadAutomationSharingStates([resourceId], client);
  return states.get(resourceId) ?? null;
}

function replacementStatements(
  resourceId: string,
  input: CompleteAutomationSharingState,
  now = Date.now(),
): { statements: DbExecStatement[]; summary: AutomationSharingSummary } {
  const id = normalizedRequired(resourceId, "Automation resource id");
  const normalized = normalizeCompleteState(input);
  const statements: DbExecStatement[] = [
    { sql: `DELETE FROM ${GRANTS_TABLE} WHERE resource_id = ?`, args: [id] },
    { sql: `DELETE FROM ${OVERLAYS_TABLE} WHERE resource_id = ?`, args: [id] },
    {
      sql: `INSERT INTO ${OVERLAYS_TABLE} (resource_id, visibility, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, normalized.visibility, normalized.organizationId, now, now],
    },
    ...normalized.grants.map(
      (grant): DbExecStatement => ({
        sql: `INSERT INTO ${GRANTS_TABLE} (resource_id, user_email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        args: [id, grant.email, grant.role, now, now],
      }),
    ),
  ];

  const storedGrants: AutomationSharingGrantRow[] = normalized.grants.map(
    (grant) => ({
      resourceId: id,
      email: grant.email,
      role: grant.role,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const summary: AutomationSharingSummary =
    input.kind === "organization"
      ? {
          resourceId: id,
          kind: "organization",
          visibility: "organization",
          organizationId: normalized.organizationId!,
          grants: [],
        }
      : input.kind === "specific"
        ? {
            resourceId: id,
            kind: "specific",
            visibility: "private",
            organizationId: normalized.organizationId,
            grants: storedGrants,
          }
        : {
            resourceId: id,
            kind: "personal",
            visibility: "private",
            organizationId: null,
            grants: [],
          };
  return { statements, summary };
}

export async function replaceAutomationSharingStateWithDb(
  client: DbExec,
  resourceId: string,
  input: CompleteAutomationSharingState,
): Promise<AutomationSharingSummary> {
  const { statements, summary } = replacementStatements(resourceId, input);
  for (const statement of statements) await client.execute(statement);
  return summary;
}

export async function deleteAutomationSharingStateWithDb(
  client: DbExec,
  resourceId: string,
): Promise<void> {
  const id = normalizedRequired(resourceId, "Automation resource id");
  await client.execute({
    sql: `DELETE FROM ${GRANTS_TABLE} WHERE resource_id = ?`,
    args: [id],
  });
  await client.execute({
    sql: `DELETE FROM ${OVERLAYS_TABLE} WHERE resource_id = ?`,
    args: [id],
  });
}

export async function replaceAutomationSharingState(
  resourceId: string,
  input: CompleteAutomationSharingState,
): Promise<AutomationSharingSummary> {
  await ensureAutomationSharingTables();
  const client = getDbExec();
  const replacement = replacementStatements(resourceId, input);

  if (getDialect() === "d1") {
    if (!client.atomicBatch) {
      throw new Error(
        "D1 automation sharing replacement requires atomic batch support.",
      );
    }
    await client.atomicBatch(replacement.statements);
    return replacement.summary;
  }
  if (!client.transaction) {
    throw new Error("Automation sharing replacement requires transactions.");
  }
  await client.transaction(async (tx) => {
    for (const statement of replacement.statements) await tx.execute(statement);
  });
  return replacement.summary;
}

export function __resetAutomationSharingStoreForTests(): void {
  initPromise = undefined;
}
