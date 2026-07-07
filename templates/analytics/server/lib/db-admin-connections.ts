import { randomUUID } from "node:crypto";

import { createDbExec, getDbExec, type Dialect } from "@agent-native/core/db";
import type { DbAdminRuntime } from "@agent-native/core/db-admin";
import { getOrgContext } from "@agent-native/core/org";
import {
  deleteAppSecret,
  getAppSecretMeta,
  readAppSecret,
  writeAppSecret,
} from "@agent-native/core/secrets";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import type { H3Event } from "h3";

const CONNECTIONS_TABLE = "analytics_db_admin_connections";
const SECRET_PREFIX = "analytics-db-admin";

export interface DbAdminConnection {
  id: string;
  name: string;
  appId: string | null;
  appUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  orgId: string;
  databaseUrlLast4: string | null;
  hasDatabaseAuthToken: boolean;
  databaseAuthTokenLast4: string | null;
}

export interface DbAdminAdminContext {
  userEmail: string;
  orgId: string;
  role: "owner" | "admin";
}

export class DbAdminConnectionError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "DbAdminConnectionError";
  }
}

function isAdminRole(value: unknown): value is "owner" | "admin" {
  return value === "owner" || value === "admin";
}

function readString(
  row: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

async function resolveOrgRole(
  userEmail: string,
  orgId: string,
): Promise<string | null> {
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, userEmail.toLowerCase()],
    });
    return readString((rows[0] ?? {}) as Record<string, unknown>, "role");
  } catch {
    return null;
  }
}

export async function requireDbAdminContextFromRequest(input?: {
  userEmail?: string;
  orgId?: string | null;
}): Promise<DbAdminAdminContext> {
  const userEmail = input?.userEmail ?? getRequestUserEmail();
  const orgId = input?.orgId ?? getRequestOrgId() ?? null;
  if (!userEmail) {
    throw new DbAdminConnectionError(401, "Sign in to manage app databases.");
  }
  if (!orgId) {
    throw new DbAdminConnectionError(
      403,
      "An active organization is required to manage app databases.",
    );
  }
  const role = await resolveOrgRole(userEmail, orgId);
  if (!isAdminRole(role)) {
    throw new DbAdminConnectionError(
      403,
      "Only organization owners and admins can access connected app databases.",
    );
  }
  return { userEmail, orgId, role };
}

export async function requireDbAdminContextFromEvent(
  event: H3Event,
): Promise<DbAdminAdminContext> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw new DbAdminConnectionError(401, "Sign in to manage app databases.");
  }
  const org = await getOrgContext(event).catch(() => null);
  if (!org?.orgId) {
    throw new DbAdminConnectionError(
      403,
      "An active organization is required to manage app databases.",
    );
  }
  if (!isAdminRole(org.role)) {
    throw new DbAdminConnectionError(
      403,
      "Only organization owners and admins can access connected app databases.",
    );
  }
  return { userEmail: session.email, orgId: org.orgId, role: org.role };
}

export async function runWithDbAdminEventContext<T>(
  event: H3Event,
  fn: (ctx: DbAdminAdminContext) => Promise<T>,
): Promise<T> {
  const ctx = await requireDbAdminContextFromEvent(event);
  return runWithRequestContext(
    { userEmail: ctx.userEmail, orgId: ctx.orgId },
    () => fn(ctx),
  );
}

function secretKey(connectionId: string, kind: "url" | "auth-token"): string {
  return `${SECRET_PREFIX}:${connectionId}:${kind}`;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDatabaseUrl(value: unknown): string {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    throw new DbAdminConnectionError(400, "Database URL is required.");
  }
  const lower = raw.toLowerCase();
  if (
    !lower.startsWith("postgres://") &&
    !lower.startsWith("postgresql://") &&
    !lower.startsWith("libsql://")
  ) {
    throw new DbAdminConnectionError(
      400,
      "Use a Postgres, PostgreSQL, or libSQL database URL.",
    );
  }
  return raw;
}

function dialectForDatabaseUrl(url: string): Dialect {
  const lower = url.toLowerCase();
  if (lower.startsWith("postgres://") || lower.startsWith("postgresql://")) {
    return "postgres";
  }
  return "sqlite";
}

function rowToConnection(
  row: Record<string, unknown>,
  secretMeta: {
    databaseUrlLast4: string | null;
    hasDatabaseAuthToken: boolean;
    databaseAuthTokenLast4: string | null;
  },
): DbAdminConnection {
  return {
    id: readString(row, "id") ?? "",
    name: readString(row, "name") ?? "Connected app",
    appId: readString(row, "appId", "app_id"),
    appUrl: readString(row, "appUrl", "app_url"),
    createdBy: readString(row, "createdBy", "created_by") ?? "",
    createdAt: readString(row, "createdAt", "created_at") ?? "",
    updatedAt: readString(row, "updatedAt", "updated_at") ?? "",
    orgId: readString(row, "orgId", "org_id") ?? "",
    ...secretMeta,
  };
}

async function secretMetadata(
  ctx: DbAdminAdminContext,
  row: Record<string, unknown>,
) {
  const urlSecretKey = readString(
    row,
    "databaseUrlSecretKey",
    "database_url_secret_key",
  );
  const authSecretKey = readString(
    row,
    "databaseAuthTokenSecretKey",
    "database_auth_token_secret_key",
  );
  const databaseUrlMeta = urlSecretKey
    ? await getAppSecretMeta({
        key: urlSecretKey,
        scope: "org",
        scopeId: ctx.orgId,
      })
    : null;
  const databaseAuthTokenMeta = authSecretKey
    ? await getAppSecretMeta({
        key: authSecretKey,
        scope: "org",
        scopeId: ctx.orgId,
      })
    : null;
  return {
    databaseUrlLast4: databaseUrlMeta?.last4 ?? null,
    hasDatabaseAuthToken: Boolean(databaseAuthTokenMeta),
    databaseAuthTokenLast4: databaseAuthTokenMeta?.last4 ?? null,
  };
}

export async function listDbAdminConnections(
  ctx: DbAdminAdminContext,
): Promise<DbAdminConnection[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, name, app_id AS "appId", app_url AS "appUrl",
                 database_url_secret_key AS "databaseUrlSecretKey",
                 database_auth_token_secret_key AS "databaseAuthTokenSecretKey",
                 created_by AS "createdBy", created_at AS "createdAt",
                 updated_at AS "updatedAt", org_id AS "orgId"
          FROM ${CONNECTIONS_TABLE}
          WHERE org_id = ?
          ORDER BY updated_at DESC, name ASC`,
    args: [ctx.orgId],
  });
  return Promise.all(
    rows.map(async (row) =>
      rowToConnection(
        row as Record<string, unknown>,
        await secretMetadata(ctx, row as Record<string, unknown>),
      ),
    ),
  );
}

export async function saveDbAdminConnection(
  ctx: DbAdminAdminContext,
  input: {
    id?: string | null;
    name: string;
    appId?: string | null;
    appUrl?: string | null;
    databaseUrl: string;
    databaseAuthToken?: string | null;
  },
): Promise<DbAdminConnection> {
  const name = normalizeOptionalString(input.name);
  if (!name)
    throw new DbAdminConnectionError(400, "Connection name is required.");
  const databaseUrl = normalizeDatabaseUrl(input.databaseUrl);
  const authToken = normalizeOptionalString(input.databaseAuthToken);
  const id = normalizeOptionalString(input.id) ?? randomUUID();
  const databaseUrlSecretKey = secretKey(id, "url");
  const databaseAuthTokenSecretKey = authToken
    ? secretKey(id, "auth-token")
    : null;
  const now = new Date().toISOString();

  await writeAppSecret({
    key: databaseUrlSecretKey,
    scope: "org",
    scopeId: ctx.orgId,
    value: databaseUrl,
    description: `${name} database URL`,
  });
  if (authToken) {
    await writeAppSecret({
      key: databaseAuthTokenSecretKey!,
      scope: "org",
      scopeId: ctx.orgId,
      value: authToken,
      description: `${name} database auth token`,
    });
  } else {
    await deleteAppSecret({
      key: secretKey(id, "auth-token"),
      scope: "org",
      scopeId: ctx.orgId,
    }).catch(() => false);
  }

  await getDbExec().execute({
    sql: `INSERT INTO ${CONNECTIONS_TABLE}
            (id, name, app_id, app_url, database_url_secret_key,
             database_auth_token_secret_key, created_by, created_at, updated_at, org_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            app_id = excluded.app_id,
            app_url = excluded.app_url,
            database_url_secret_key = excluded.database_url_secret_key,
            database_auth_token_secret_key = excluded.database_auth_token_secret_key,
            updated_at = excluded.updated_at
          WHERE ${CONNECTIONS_TABLE}.org_id = excluded.org_id`,
    args: [
      id,
      name,
      normalizeOptionalString(input.appId),
      normalizeOptionalString(input.appUrl),
      databaseUrlSecretKey,
      databaseAuthTokenSecretKey,
      ctx.userEmail,
      now,
      now,
      ctx.orgId,
    ],
  });

  const connection = await getDbAdminConnection(ctx, id);
  if (!connection) {
    throw new DbAdminConnectionError(404, "Connection not found.");
  }
  return connection;
}

export async function deleteDbAdminConnection(
  ctx: DbAdminAdminContext,
  id: string,
): Promise<{ deleted: boolean }> {
  const target = await getConnectionRow(ctx, id);
  if (!target) return { deleted: false };

  await getDbExec().execute({
    sql: `DELETE FROM ${CONNECTIONS_TABLE} WHERE id = ? AND org_id = ?`,
    args: [id, ctx.orgId],
  });
  await deleteAppSecret({
    key: readString(target, "databaseUrlSecretKey", "database_url_secret_key")!,
    scope: "org",
    scopeId: ctx.orgId,
  }).catch(() => false);
  const authKey = readString(
    target,
    "databaseAuthTokenSecretKey",
    "database_auth_token_secret_key",
  );
  if (authKey) {
    await deleteAppSecret({
      key: authKey,
      scope: "org",
      scopeId: ctx.orgId,
    }).catch(() => false);
  }
  return { deleted: true };
}

async function getConnectionRow(
  ctx: DbAdminAdminContext,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, name, app_id AS "appId", app_url AS "appUrl",
                 database_url_secret_key AS "databaseUrlSecretKey",
                 database_auth_token_secret_key AS "databaseAuthTokenSecretKey",
                 created_by AS "createdBy", created_at AS "createdAt",
                 updated_at AS "updatedAt", org_id AS "orgId"
          FROM ${CONNECTIONS_TABLE}
          WHERE id = ? AND org_id = ?
          LIMIT 1`,
    args: [id, ctx.orgId],
  });
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function getDbAdminConnection(
  ctx: DbAdminAdminContext,
  id: string,
): Promise<DbAdminConnection | null> {
  const row = await getConnectionRow(ctx, id);
  if (!row) return null;
  return rowToConnection(row, await secretMetadata(ctx, row));
}

export async function withDbAdminConnectionRuntime<T>(
  ctx: DbAdminAdminContext,
  id: string,
  fn: (runtime: DbAdminRuntime, connection: DbAdminConnection) => Promise<T>,
): Promise<T> {
  const row = await getConnectionRow(ctx, id);
  if (!row) throw new DbAdminConnectionError(404, "Connection not found.");

  const databaseUrlSecretKey = readString(
    row,
    "databaseUrlSecretKey",
    "database_url_secret_key",
  );
  if (!databaseUrlSecretKey) {
    throw new DbAdminConnectionError(
      500,
      "Connection is missing database URL metadata.",
    );
  }
  const databaseUrl = await readAppSecret({
    key: databaseUrlSecretKey,
    scope: "org",
    scopeId: ctx.orgId,
  });
  if (!databaseUrl?.value) {
    throw new DbAdminConnectionError(400, "Database URL secret is missing.");
  }

  const authSecretKey = readString(
    row,
    "databaseAuthTokenSecretKey",
    "database_auth_token_secret_key",
  );
  const authToken = authSecretKey
    ? await readAppSecret({
        key: authSecretKey,
        scope: "org",
        scopeId: ctx.orgId,
      })
    : null;

  const exec = await createDbExec({
    url: databaseUrl.value,
    authToken: authToken?.value,
  });
  try {
    return await fn(
      {
        db: exec,
        dialect: dialectForDatabaseUrl(databaseUrl.value),
      },
      rowToConnection(row, await secretMetadata(ctx, row)),
    );
  } finally {
    await exec.close?.().catch(() => {});
  }
}

export function redactDbAdminError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[redacted]@")
    .replace(/(libsql:\/\/[^?\s]+[?&]authToken=)[^&\s]+/gi, "$1[redacted]");
}
