/** Server-only personal authorization grants. Bundles live only in the vault. */
import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { getDbExec } from "../db/client.js";
import { defineStore } from "../db/store-registry.js";
import { readAppSecret, writeAppSecret } from "../secrets/storage.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import { getRequestContext } from "../server/request-context.js";

const MAX = Number.MAX_SAFE_INTEGER;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/);
const provider = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const operationId = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const integer = z.number().int().positive().max(MAX);
const grantId = z.string().regex(/^uig_[a-f0-9]{64}$/);
const scopeName = z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/);
const token = z
  .string()
  .min(1)
  .max(65_536)
  .regex(/^[\x21-\x7e]+$/);
const tupleSchema = z
  .object({ provider, teamId: id, apiAppId: id, externalUserId: id })
  .strict();
const beginSchema = tupleSchema.extend({ operationId }).strict();
const attemptSchema = z
  .object({ grantId, generation: integer, operationId })
  .strict();
const bundleSchema = z
  .object({
    accessToken: token,
    refreshToken: token.optional(),
    tokenType: z.literal("user"),
    expiresAt: integer.optional(),
    scopes: z.array(scopeName).max(256),
  })
  .strict();
const historySchema = z
  .array(z.object({ id: operationId, generation: integer }).strict())
  .min(1)
  .max(4096);

export type UserIntegrationGrantAttempt = z.infer<typeof attemptSchema>;
export type UserIntegrationGrantBundle = z.infer<typeof bundleSchema>;
export type BeginUserIntegrationGrantInput = z.infer<typeof beginSchema>;
export interface UserIntegrationGrant {
  id: string;
  provider: string;
  teamId: string;
  apiAppId: string;
  externalUserId: string;
  generation: number;
  status: "pending" | "connected" | "revoked";
  scopes: string[];
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export class UserIntegrationGrantUnavailableError extends Error {
  constructor() {
    super("User authorization is unavailable.");
    this.name = "UserIntegrationGrantUnavailableError";
  }
}
export class UserIntegrationGrantConflictError extends Error {
  constructor() {
    super("User authorization changed. Read it again before retrying.");
    this.name = "UserIntegrationGrantConflictError";
  }
}
export class UserIntegrationGrantUnknownOutcomeError extends Error {
  constructor() {
    super("User authorization outcome could not be verified.");
    this.name = "UserIntegrationGrantUnknownOutcomeError";
  }
}

export const userIntegrationGrantsStore = defineStore({
  id: "integration_user_grants",
  migrations: [
    {
      name: "baseline",
      sql: [
        `CREATE TABLE IF NOT EXISTS integration_user_grants (
      id TEXT PRIMARY KEY, owner_auth_user_id TEXT NOT NULL, owner_email TEXT NOT NULL,
      org_id TEXT, provider TEXT NOT NULL, team_id TEXT NOT NULL, api_app_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL, generation BIGINT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','connected','revoked')),
      operation_id TEXT NOT NULL, operations_json TEXT NOT NULL,
      -- guard:allow-plaintext-secret-column — holds only the app_secrets key name; the bundle lives in the vault.
      token_secret_key TEXT,
      scopes_json TEXT NOT NULL, expires_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
    )`,
        `CREATE INDEX IF NOT EXISTS idx_integration_user_grants_actor ON integration_user_grants(owner_auth_user_id, org_id)`,
      ],
    },
  ],
});
export function ensureUserIntegrationGrantsTable(): Promise<void> {
  return userIntegrationGrantsStore.ready();
}

interface Actor {
  principal: string;
  email: string;
  orgId: string | null;
}
interface Row extends UserIntegrationGrant {
  principal: string;
  email: string;
  orgId: string | null;
  operationId: string;
  operations: z.infer<typeof historySchema>;
  secretKey: string | null;
}
const opaque = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 512 && !s.includes("\0");
async function actor(): Promise<Actor> {
  const ctx = getRequestContext();
  if (
    !ctx ||
    !opaque(ctx.authUserId) ||
    !ctx.authUserId.trim() ||
    !opaque(ctx.userEmail) ||
    (ctx.orgId !== undefined &&
      (!opaque(ctx.orgId) || ctx.orgId !== ctx.orgId.trim()))
  )
    throw new UserIntegrationGrantUnavailableError();
  const a = {
    principal: ctx.authUserId,
    email: ctx.userEmail.trim().toLowerCase(),
    orgId: ctx.orgId ?? null,
  };
  if (!/^[^\s@]+@[^\s@]+$/.test(a.email))
    throw new UserIntegrationGrantUnavailableError();
  if (a.orgId) {
    try {
      if (await readOrgMemberRole(a.orgId, a.email)) return a;
    } catch {
      // coercion-ok: an unreadable membership falls through to the Unavailable throw below.
    }
    throw new UserIntegrationGrantUnavailableError();
  }
  return a;
}
async function assertCurrentActor(expected: Actor): Promise<void> {
  const current = await actor();
  if (
    current.principal !== expected.principal ||
    current.orgId !== expected.orgId
  )
    throw new UserIntegrationGrantUnavailableError();
}
function key(
  a: Pick<Actor, "principal" | "orgId">,
  t: z.infer<typeof tupleSchema>,
): string {
  return (
    "uig_" +
    createHash("sha256")
      .update(
        JSON.stringify([
          1,
          a.principal,
          a.orgId,
          t.provider,
          t.teamId,
          t.apiAppId,
          t.externalUserId,
        ]),
      )
      .digest("hex")
  );
}
function increment(n: number) {
  if (!Number.isSafeInteger(n) || n < 1 || n >= MAX)
    throw new UserIntegrationGrantConflictError();
  return n + 1;
}
function canonicalBundle(value: unknown): UserIntegrationGrantBundle {
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success) throw new UserIntegrationGrantUnavailableError();
  const b = parsed.data;
  return {
    accessToken: b.accessToken,
    tokenType: "user",
    scopes: [...new Set(b.scopes)].sort(),
    ...(b.refreshToken === undefined ? {} : { refreshToken: b.refreshToken }),
    ...(b.expiresAt === undefined ? {} : { expiresAt: b.expiresAt }),
  };
}
function safe(r: Row): UserIntegrationGrant {
  return {
    id: r.id,
    provider: r.provider,
    teamId: r.teamId,
    apiAppId: r.apiAppId,
    externalUserId: r.externalUserId,
    generation: r.generation,
    status: r.status,
    scopes: [...r.scopes],
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
function decode(raw: Record<string, unknown>): Row {
  try {
    if (
      !opaque(raw.owner_auth_user_id) ||
      !opaque(raw.owner_email) ||
      (raw.org_id !== null && raw.org_id !== undefined && !opaque(raw.org_id))
    )
      throw new Error();
    const t = tupleSchema.parse({
      provider: raw.provider,
      teamId: raw.team_id,
      apiAppId: raw.api_app_id,
      externalUserId: raw.external_user_id,
    });
    const r: Row = {
      ...t,
      id: grantId.parse(raw.id),
      principal: raw.owner_auth_user_id,
      email: raw.owner_email,
      orgId: raw.org_id == null ? null : (raw.org_id as string),
      generation: integer.parse(Number(raw.generation)),
      status: z.enum(["pending", "connected", "revoked"]).parse(raw.status),
      operationId: operationId.parse(raw.operation_id),
      operations: historySchema.parse(JSON.parse(String(raw.operations_json))),
      secretKey:
        raw.token_secret_key == null
          ? null
          : z.string().min(1).parse(raw.token_secret_key),
      scopes: z
        .array(scopeName)
        .max(256)
        .parse(JSON.parse(String(raw.scopes_json))),
      expiresAt:
        raw.expires_at == null ? null : integer.parse(Number(raw.expires_at)),
      createdAt: integer.parse(Number(raw.created_at)),
      updatedAt: integer.parse(Number(raw.updated_at)),
    };
    if (
      !opaque(r.principal) ||
      !/^[^\s@]+@[^\s@]+$/.test(r.email) ||
      r.email !== r.email.trim().toLowerCase() ||
      key(r, t) !== r.id ||
      new Set(r.operations.map((o) => o.id)).size !== r.operations.length ||
      r.operations.some(
        (o, i) =>
          o.generation > r.generation ||
          (i > 0 && o.generation <= (r.operations[i - 1]?.generation ?? MAX)),
      ) ||
      r.operations.at(-1)?.id !== r.operationId ||
      r.operations.at(-1)?.generation !==
        r.generation - (r.status === "revoked" ? 1 : 0) ||
      JSON.stringify(r.scopes) !==
        JSON.stringify([...new Set(r.scopes)].sort()) ||
      (r.secretKey !== null &&
        !r.secretKey.startsWith(`integration-user-grant:${r.id}:`))
    )
      throw new Error();
    return r;
  } catch {
    throw new UserIntegrationGrantUnavailableError();
  }
}
// Every statement scopes the row with `id`, `owner_auth_user_id` and
// `org_id IS NOT DISTINCT FROM`, bound in that order.
const argsFor = (a: Actor, value: string) => [value, a.principal, a.orgId];
async function load(a: Actor, value: string): Promise<Row | null> {
  if (!grantId.safeParse(value).success) return null;
  try {
    await ensureUserIntegrationGrantsTable();
    const { rows } = await getDbExec().execute({
      sql: "SELECT * FROM integration_user_grants WHERE id = ? AND owner_auth_user_id = ? AND org_id IS NOT DISTINCT FROM ?",
      args: argsFor(a, value),
    });
    return rows[0] ? decode(rows[0] as Record<string, unknown>) : null;
  } catch {
    throw new UserIntegrationGrantUnavailableError();
  }
}
const attemptFor = (
  r: Row,
  op: { id: string; generation: number },
): UserIntegrationGrantAttempt => ({
  grantId: r.id,
  generation: op.generation,
  operationId: op.id,
});

/** Begin once per explicit authorization intent; retries reuse operationId. */
export async function beginUserIntegrationGrant(
  input: BeginUserIntegrationGrantInput,
): Promise<UserIntegrationGrantAttempt> {
  const a = await actor(),
    parsed = beginSchema.safeParse(input);
  if (!parsed.success) throw new UserIntegrationGrantUnavailableError();
  const t = parsed.data,
    value = key(a, t);
  await ensureUserIntegrationGrantsTable();
  for (let round = 0; round < 5; round++) {
    const previous = await load(a, value);
    const duplicate = previous?.operations.find((o) => o.id === t.operationId);
    if (previous && duplicate) return attemptFor(previous, duplicate);
    if (previous && previous.operations.length >= 4096)
      throw new UserIntegrationGrantConflictError();
    const generation = previous ? increment(previous.generation) : 1;
    const operations = [
      ...(previous?.operations ?? []),
      { id: t.operationId, generation },
    ];
    const time = Date.now();
    await assertCurrentActor(a);
    try {
      const result = previous
        ? await getDbExec().execute({
            sql: `UPDATE integration_user_grants SET generation = ?, status = 'pending', operation_id = ?, operations_json = ?, token_secret_key = NULL, scopes_json = '[]', expires_at = NULL, updated_at = ? WHERE id = ? AND owner_auth_user_id = ? AND org_id IS NOT DISTINCT FROM ? AND generation = ?`,
            args: [
              generation,
              t.operationId,
              JSON.stringify(operations),
              time,
              ...argsFor(a, value),
              previous.generation,
            ],
          })
        : await getDbExec().execute({
            sql: `INSERT INTO integration_user_grants (id, owner_auth_user_id, owner_email, org_id, provider, team_id, api_app_id, external_user_id, generation, status, operation_id, operations_json, scopes_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, '[]', ?, ?) ON CONFLICT (id) DO NOTHING`,
            args: [
              value,
              a.principal,
              a.email,
              a.orgId,
              t.provider,
              t.teamId,
              t.apiAppId,
              t.externalUserId,
              generation,
              t.operationId,
              JSON.stringify(operations),
              time,
              time,
            ],
          });
      if (!result.rowsAffected) continue;
      const read = await load(a, value),
        recorded = read?.operations.find((o) => o.id === t.operationId);
      if (read && recorded) return attemptFor(read, recorded);
      throw new UserIntegrationGrantUnknownOutcomeError();
    } catch {
      try {
        const read = await load(a, value),
          recorded = read?.operations.find((o) => o.id === t.operationId);
        if (read && recorded) return attemptFor(read, recorded);
      } catch {
        /* unknown */
      }
      throw new UserIntegrationGrantUnknownOutcomeError();
    }
  }
  throw new UserIntegrationGrantConflictError();
}

export async function getUserIntegrationGrant(
  value: string,
): Promise<UserIntegrationGrant | null> {
  const a = await actor(),
    r = await load(a, value);
  await assertCurrentActor(a);
  return r ? safe(r) : null;
}
function currentAttempt(r: Row, attempt: UserIntegrationGrantAttempt) {
  return (
    r.generation === attempt.generation && r.operationId === attempt.operationId
  );
}
/**
 * Null means the stored bundle is missing or no longer matches its grant row,
 * which reconnecting fixes. A vault that cannot be read throws instead, so a
 * transient outage never reads as "not connected".
 */
async function readBundle(r: Row): Promise<UserIntegrationGrantBundle | null> {
  if (!r.secretKey) return null;
  let secret: Awaited<ReturnType<typeof readAppSecret>>;
  try {
    secret = await readAppSecret({
      key: r.secretKey,
      scope: "user",
      scopeId: r.email,
    });
  } catch {
    throw new UserIntegrationGrantUnavailableError();
  }
  if (!secret) return null;
  let b: UserIntegrationGrantBundle;
  try {
    b = canonicalBundle(JSON.parse(secret.value));
  } catch {
    // coercion-ok: a malformed stored bundle is unusable and the remedy is to reconnect; the payload is never echoed.
    return null;
  }
  if (
    (b.expiresAt ?? null) !== r.expiresAt ||
    JSON.stringify(b.scopes) !== JSON.stringify(r.scopes)
  )
    return null;
  return b;
}
async function completedDuplicate(
  a: Actor,
  r: Row,
  attempt: UserIntegrationGrantAttempt,
  b: UserIntegrationGrantBundle,
): Promise<UserIntegrationGrant> {
  if (!currentAttempt(r, attempt) || r.status !== "connected")
    throw new UserIntegrationGrantConflictError();
  const stored = await readBundle(r);
  if (!stored) throw new UserIntegrationGrantUnavailableError();
  if (JSON.stringify(stored) !== JSON.stringify(b))
    throw new UserIntegrationGrantConflictError();
  const after = await load(await actor(), r.id);
  if (
    !after ||
    !currentAttempt(after, attempt) ||
    after.status !== "connected" ||
    after.secretKey !== r.secretKey ||
    after.email !== r.email ||
    a.principal !== after.principal
  )
    throw new UserIntegrationGrantConflictError();
  return safe(after);
}

/** Publish a new immutable vault bundle only into the current pending generation. */
export async function completeUserIntegrationGrant(
  input: UserIntegrationGrantAttempt,
  payload: UserIntegrationGrantBundle,
): Promise<UserIntegrationGrant> {
  const a = await actor(),
    parsed = attemptSchema.safeParse(input);
  if (!parsed.success) throw new UserIntegrationGrantUnavailableError();
  const attempt = parsed.data,
    r = await load(a, attempt.grantId);
  if (!r) throw new UserIntegrationGrantUnavailableError();
  if (!currentAttempt(r, attempt) || r.status === "revoked")
    throw new UserIntegrationGrantConflictError();
  const b = canonicalBundle(payload);
  if (b.expiresAt !== undefined && b.expiresAt <= Date.now())
    throw new UserIntegrationGrantConflictError();
  if (r.status === "connected") return completedDuplicate(a, r, attempt, b);
  await assertCurrentActor(a);
  const secretKey = `integration-user-grant:${r.id}:${randomUUID()}`;
  try {
    await writeAppSecret({
      key: secretKey,
      scope: "user",
      scopeId: r.email,
      value: JSON.stringify(b),
      description: "Personal authorization bundle",
    });
  } catch {
    throw new UserIntegrationGrantUnknownOutcomeError();
  }
  await assertCurrentActor(a);
  let outcomeUnknown = false;
  try {
    await getDbExec().execute({
      sql: `UPDATE integration_user_grants SET status = 'connected', token_secret_key = ?, scopes_json = ?, expires_at = ?, updated_at = ? WHERE id = ? AND owner_auth_user_id = ? AND org_id IS NOT DISTINCT FROM ? AND generation = ? AND operation_id = ? AND status = 'pending' AND owner_email = ?`,
      args: [
        secretKey,
        JSON.stringify(b.scopes),
        b.expiresAt ?? null,
        Date.now(),
        ...argsFor(a, r.id),
        attempt.generation,
        attempt.operationId,
        r.email,
      ],
    });
  } catch {
    outcomeUnknown = true;
  }
  let read: Row | null;
  try {
    read = await load(await actor(), r.id);
  } catch {
    throw new UserIntegrationGrantUnknownOutcomeError();
  }
  if (
    read &&
    currentAttempt(read, attempt) &&
    read.status === "connected" &&
    read.secretKey === secretKey &&
    read.email === r.email
  )
    return safe(read);
  if (outcomeUnknown) throw new UserIntegrationGrantUnknownOutcomeError();
  if (!read || read.email !== r.email)
    throw new UserIntegrationGrantConflictError();
  return completedDuplicate(a, read, attempt, b);
}

/**
 * Resolve transiently, with a fresh authorization and generation check after
 * the vault read. Null means there is no usable grant (absent, another
 * owner's, pending, revoked, expired, superseded during the read, or a
 * malformed bundle). A database or vault that cannot be read, or a corrupted
 * grant row, throws `UserIntegrationGrantUnavailableError`.
 */
export async function resolveUserIntegrationGrant(
  value: string,
): Promise<UserIntegrationGrantBundle | null> {
  const a = await actor();
  const r = await load(a, value);
  if (
    !r ||
    r.status !== "connected" ||
    !r.secretKey ||
    (r.expiresAt !== null && r.expiresAt <= Date.now())
  )
    return null;
  const b = await readBundle(r);
  if (!b) return null;
  const after = await load(await actor(), value);
  if (
    !after ||
    after.status !== "connected" ||
    after.generation !== r.generation ||
    after.secretKey !== r.secretKey ||
    after.email !== r.email ||
    (after.expiresAt !== null && after.expiresAt <= Date.now())
  )
    return null;
  return b;
}

/** Local revocation only: never calls a provider or deletes historical vault entries. */
export async function revokeUserIntegrationGrant(
  value: string,
): Promise<UserIntegrationGrant | null> {
  const a = await actor();
  for (let round = 0; round < 5; round++) {
    const r = await load(a, value);
    if (!r) return null;
    if (r.status === "revoked") return safe(r);
    const generation = increment(r.generation);
    await assertCurrentActor(a);
    let unknown = false;
    try {
      const result = await getDbExec().execute({
        sql: `UPDATE integration_user_grants SET generation = ?, status = 'revoked', token_secret_key = NULL, scopes_json = '[]', expires_at = NULL, updated_at = ? WHERE id = ? AND owner_auth_user_id = ? AND org_id IS NOT DISTINCT FROM ? AND generation = ?`,
        args: [generation, Date.now(), ...argsFor(a, value), r.generation],
      });
      if (!result.rowsAffected) continue;
    } catch {
      unknown = true;
    }
    try {
      const after = await load(a, value);
      if (
        after &&
        after.generation >= generation &&
        after.status === "revoked" &&
        !after.secretKey
      )
        return safe(after);
    } catch {
      // coercion-ok: an unreadable read-back falls through to the UnknownOutcome throw below.
    }
    if (unknown) throw new UserIntegrationGrantUnknownOutcomeError();
    throw new UserIntegrationGrantUnknownOutcomeError();
  }
  throw new UserIntegrationGrantConflictError();
}
