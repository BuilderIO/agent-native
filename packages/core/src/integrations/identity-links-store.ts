/**
 * Durable links between a verified provider identity and an Agent Native user.
 * Provider credentials and raw provider payloads never belong in this table.
 */

import { randomUUID } from "node:crypto";

import {
  getDbExec,
  intType,
  isPostgres,
  isUniqueViolation,
  retryOnDdlRace,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

const TABLE = "integration_identity_links";
let _initPromise: Promise<void> | undefined;

export interface IntegrationIdentityLink {
  id: string;
  platform: string;
  tenantId: string;
  externalUserId: string;
  userEmail: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}

function createSql(): string {
  const integer = intType();
  return `CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    org_id TEXT NOT NULL,
    created_at ${integer} NOT NULL,
    updated_at ${integer} NOT NULL
  )`;
}

const INDEXES = [
  [
    "idx_integration_identity_links_external",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_identity_links_external
      ON ${TABLE}(platform, tenant_id, external_user_id)`,
  ],
  [
    "idx_integration_identity_links_account",
    `CREATE INDEX IF NOT EXISTS idx_integration_identity_links_account
      ON ${TABLE}(org_id, user_email)`,
  ],
] as const;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      if (isPostgres()) {
        await ensureTableExists(TABLE, createSql());
        for (const [name, sql] of INDEXES) {
          await ensureIndexExists(name, sql);
        }
        return;
      }
      await retryOnDdlRace(() => client.execute(createSql()));
      for (const [, sql] of INDEXES) {
        await retryOnDdlRace(() => client.execute(sql));
      }
    })().catch((error) => {
      _initPromise = undefined;
      throw error;
    });
  }
  return _initPromise;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > 512) throw new Error(`${name} is too long`);
  return normalized;
}

function normalizePlatform(value: string): string {
  return required(value, "platform").toLowerCase();
}

function normalizeEmail(value: string): string {
  const normalized = required(value, "userEmail").toLowerCase();
  if (!normalized.includes("@")) throw new Error("userEmail must be an email");
  return normalized;
}

function rowToLink(row: Record<string, unknown>): IntegrationIdentityLink {
  return {
    id: String(row.id),
    platform: String(row.platform),
    tenantId: String(row.tenant_id),
    externalUserId: String(row.external_user_id),
    userEmail: String(row.user_email),
    orgId: String(row.org_id),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

async function selectByExternalIdentity(
  platform: string,
  tenantId: string,
  externalUserId: string,
): Promise<IntegrationIdentityLink | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE}
      WHERE platform = ? AND tenant_id = ? AND external_user_id = ?
      LIMIT 1`,
    args: [platform, tenantId, externalUserId],
  });
  return rows[0] ? rowToLink(rows[0] as Record<string, unknown>) : null;
}

function matchesVerifiedLink(
  row: IntegrationIdentityLink,
  input: { userEmail: string; orgId: string },
): boolean {
  return row.userEmail === input.userEmail && row.orgId === input.orgId;
}

/** Persist a verified mapping and fail closed if it changes identity later. */
export async function upsertVerifiedIntegrationIdentity(input: {
  platform: string;
  tenantId: string;
  externalUserId: string;
  userEmail: string;
  orgId: string;
}): Promise<IntegrationIdentityLink> {
  const platform = normalizePlatform(input.platform);
  const tenantId = required(input.tenantId, "tenantId");
  const externalUserId = required(input.externalUserId, "externalUserId");
  const userEmail = normalizeEmail(input.userEmail);
  const orgId = required(input.orgId, "orgId");
  const existing = await selectByExternalIdentity(
    platform,
    tenantId,
    externalUserId,
  );

  if (existing) {
    if (!matchesVerifiedLink(existing, { userEmail, orgId })) {
      throw new Error(
        "This provider identity is already linked to a different Agent Native account.",
      );
    }
    const updatedAt = Date.now();
    await getDbExec().execute({
      sql: `UPDATE ${TABLE} SET updated_at = ? WHERE id = ?`,
      args: [updatedAt, existing.id],
    });
    return { ...existing, updatedAt };
  }

  const id = randomUUID();
  const now = Date.now();
  try {
    await getDbExec().execute({
      sql: `INSERT INTO ${TABLE} (
        id, platform, tenant_id, external_user_id, user_email, org_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        platform,
        tenantId,
        externalUserId,
        userEmail,
        orgId,
        now,
        now,
      ],
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await selectByExternalIdentity(
      platform,
      tenantId,
      externalUserId,
    );
    if (!raced || !matchesVerifiedLink(raced, { userEmail, orgId })) {
      throw new Error(
        "This provider identity is already linked to a different Agent Native account.",
      );
    }
    return raced;
  }

  return {
    id,
    platform,
    tenantId,
    externalUserId,
    userEmail,
    orgId,
    createdAt: now,
    updatedAt: now,
  };
}
