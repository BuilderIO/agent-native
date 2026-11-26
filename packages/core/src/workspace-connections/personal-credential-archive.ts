import { actionFailureEffect, isNoWriteError } from "../action.js";
import { getDbExec, withDbExec, type DbExec } from "../db/client.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import { getRequestContext } from "../server/request-context.js";
import { readPersonalCredentialDataRecord } from "./personal-provider-definitions.js";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
  listWorkspaceConnectionGrants,
} from "./store.js";

type ArchiveErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "transaction_unavailable"
  | "refused"
  | "write_failed";

const DEFAULT_STATUS: Record<ArchiveErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  transaction_unavailable: 503,
  refused: 409,
  write_failed: 500,
};

const STATIC_MESSAGE =
  "Personal credential archive outcome could not be confirmed.";
const APP_KEYS: ReadonlySet<string> = new Set(["appId"]);
const INPUT_KEYS: ReadonlySet<string> = new Set(["connectionId"]);
const CONNECTION_ID_PATTERN = /^pconn1:[0-9a-f]{64}$/;
const ORG_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "member"]);
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))";
const OWNED_SQL =
  "SELECT id FROM public.workspace_connections WHERE id = ? AND owner_email = ? AND org_id IS NOT DISTINCT FROM ? FOR UPDATE";
const ARCHIVE_SQL = `UPDATE public.workspace_connections SET status = 'disabled', updated_at = ? WHERE id = ? AND owner_email = ? AND org_id IS NOT DISTINCT FROM ?`;

type Connection = NonNullable<
  Awaited<ReturnType<typeof getWorkspaceConnection>>
>;
type Grant = Awaited<ReturnType<typeof listWorkspaceConnectionGrants>>[number];

interface Actor {
  email: string;
  orgId: string | null;
}

interface RawContext {
  userEmail: unknown;
  orgId: unknown;
  credentialScope: unknown;
}

interface Transactional {
  transaction: <T>(fn: (tx: DbExec) => Promise<T>) => Promise<T>;
}

/** Closed, input-free error. Native messages, SQL, and values never leave this module. */
export class PersonalWorkspaceCredentialArchiveError extends Error {
  /** Static: an unknown or unreadable failure never proves that nothing was written. */
  static readonly neutralOutcome = "unconfirmed" as const;
  readonly code: ArchiveErrorCode;
  readonly statusCode: number;

  constructor(
    code: ArchiveErrorCode,
    statusCode: number = DEFAULT_STATUS[code],
  ) {
    super(STATIC_MESSAGE);
    this.name = "PersonalWorkspaceCredentialArchiveError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code: ArchiveErrorCode, statusCode?: number): never {
  throw new PersonalWorkspaceCredentialArchiveError(code, statusCode);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function readStrictRecord(
  value: unknown,
  code: ArchiveErrorCode,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  try {
    return readPersonalCredentialDataRecord(value, allowed);
  } catch {
    return fail(code);
  }
}

function readOwnValue(source: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) {
    if (key in source) fail("unauthenticated");
    return undefined;
  }
  if (!("value" in descriptor)) fail("unauthenticated");
  return descriptor.value;
}

/** Reads only the three identity fields as own data properties. Nothing else in the context is inspected. */
function readRawContext(): RawContext {
  try {
    const context: unknown = getRequestContext();
    if (typeof context !== "object" || context === null)
      fail("unauthenticated");
    return {
      userEmail: readOwnValue(context, "userEmail"),
      orgId: readOwnValue(context, "orgId"),
      credentialScope: readOwnValue(context, "credentialScope"),
    };
  } catch {
    return fail("unauthenticated");
  }
}

/** Only the captured request context is trusted. The ambient env fallback is never read. */
function readActor(): Actor {
  const raw = readRawContext();
  if (raw.credentialScope !== undefined) fail("forbidden");
  const email =
    typeof raw.userEmail === "string" ? normalizeEmail(raw.userEmail) : "";
  if (!email) fail("unauthenticated");
  if (raw.orgId === undefined) return { email, orgId: null };
  if (typeof raw.orgId !== "string" || raw.orgId.trim().length === 0)
    fail("unauthenticated");
  return { email, orgId: raw.orgId.trim() };
}

function sameActor(left: Actor, right: Actor): boolean {
  return left.email === right.email && left.orgId === right.orgId;
}

async function assertOrgMember(actor: Actor): Promise<void> {
  if (actor.orgId === null) return;
  const role: unknown = await readOrgMemberRole(actor.orgId, actor.email);
  if (typeof role !== "string" || !ORG_ROLES.has(role)) fail("forbidden");
}

/** Fresh identity and membership gate. The actor must match the snapshot before and after the membership read. */
async function assertSnapshot(snapshot: Actor): Promise<void> {
  if (!sameActor(readActor(), snapshot)) fail("forbidden");
  await assertOrgMember(snapshot);
  if (!sameActor(readActor(), snapshot)) fail("forbidden");
}

function readConnectionId(input: unknown): string {
  const connectionId = readStrictRecord(
    input,
    "invalid_input",
    INPUT_KEYS,
  ).connectionId;
  if (
    typeof connectionId !== "string" ||
    !CONNECTION_ID_PATTERN.test(connectionId)
  ) {
    fail("invalid_input");
  }
  return connectionId;
}

function readAppId(options: unknown): string {
  const appId = readStrictRecord(options, "invalid_input", APP_KEYS).appId;
  if (typeof appId !== "string" || appId.trim().length === 0)
    fail("invalid_input");
  return appId.trim();
}

function readExec(): DbExec {
  try {
    return getDbExec();
  } catch {
    return fail("transaction_unavailable");
  }
}

/** Binds the native transaction method to its adapter. A throwing getter or a missing method closes as unavailable. */
function transactionalExec(): Transactional {
  const db = readExec();
  let transaction: unknown;
  try {
    transaction = Reflect.get(db, "transaction");
  } catch {
    fail("transaction_unavailable");
  }
  if (typeof transaction !== "function") fail("transaction_unavailable");
  const native = transaction;
  return {
    transaction: <T>(fn: (tx: DbExec) => Promise<T>): Promise<T> =>
      Reflect.apply(native, db, [fn]),
  };
}

function isPersonalRef(ref: { ref?: string; scope?: string }): boolean {
  return ref.ref === "connection" && ref.scope === "user";
}

/** Exact personal, exclusive-to-this-app shape. Any other shape is forbidden. */
function assertArchivable(
  connection: Connection,
  actor: Actor,
  appId: string,
  grants: readonly Grant[],
): void {
  if (
    normalizeEmail(connection.ownerEmail) !== actor.email ||
    connection.orgId !== actor.orgId
  ) {
    fail("forbidden");
  }
  if (connection.config.workspaceConnectionScope !== "user") fail("forbidden");
  if (!connection.credentialRefs.every(isPersonalRef)) fail("forbidden");
  if (
    connection.allowedApps.length !== 1 ||
    connection.allowedApps[0] !== appId
  )
    fail("forbidden");
  if (
    grants.length !== 1 ||
    !grants.every(
      (grant) =>
        grant.appId === appId &&
        grant.connectionId === connection.id &&
        normalizeEmail(grant.ownerEmail) === actor.email &&
        grant.orgId === actor.orgId,
    )
  ) {
    fail("forbidden");
  }
}

/** Runs inside the transaction. Only the disabled status column is ever written. */
async function archiveLocked(
  exec: DbExec,
  connectionId: string,
  appId: string,
  snapshot: Actor,
): Promise<boolean> {
  await exec.execute({
    sql: LOCK_SQL,
    args: [`personal-workspace-credential:${connectionId}`],
  });
  await assertSnapshot(snapshot);
  const owned = await exec.execute({
    sql: OWNED_SQL,
    args: [connectionId, snapshot.email, snapshot.orgId],
  });
  if (owned.rows.length === 0) return false;
  await assertSnapshot(snapshot);
  const connection = await getWorkspaceConnection(connectionId);
  if (!connection) return false;
  const grants = await listWorkspaceConnectionGrants({ connectionId });
  assertArchivable(connection, snapshot, appId, grants);
  await assertSnapshot(snapshot);
  if (connection.status === "disabled") return true;
  const updated = await exec.execute({
    sql: ARCHIVE_SQL,
    args: [Date.now(), connectionId, snapshot.email, snapshot.orgId],
  });
  if (updated.rowsAffected !== 1) fail("write_failed");
  return true;
}

function readRefusalStatus(error: unknown): number | undefined {
  if (
    error === null ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return undefined;
  }
  const candidate = error as { statusCode?: unknown; status?: unknown };
  for (const key of ["statusCode", "status"] as const) {
    const status = candidate[key];
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500
    ) {
      return status;
    }
  }
  return undefined;
}

/** Explicit refusal evidence: a no-write predicate or a plain 4xx status. Anything else is unknown. */
function classifyRefusal(
  error: unknown,
): { status: number | undefined } | null {
  if (isNoWriteError(error) || actionFailureEffect(error) === "none") {
    return { status: readRefusalStatus(error) };
  }
  const status = readRefusalStatus(error);
  return status === undefined ? null : { status };
}

/** Every classifier runs inside this guard. An unreadable error stops closed as refused 409. */
function toArchiveError(
  error: unknown,
): PersonalWorkspaceCredentialArchiveError {
  try {
    if (error instanceof PersonalWorkspaceCredentialArchiveError) return error;
    const refusal = classifyRefusal(error);
    if (refusal === null)
      return new PersonalWorkspaceCredentialArchiveError("write_failed");
    return new PersonalWorkspaceCredentialArchiveError(
      "refused",
      refusal.status,
    );
  } catch {
    return new PersonalWorkspaceCredentialArchiveError("refused");
  }
}

async function archiveConnection(
  appId: string,
  input: unknown,
): Promise<{ archived: boolean }> {
  try {
    const connectionId = readConnectionId(input);
    const snapshot = readActor();
    const db = transactionalExec();
    await ensureWorkspaceConnectionsTable();
    await assertSnapshot(snapshot);
    const archived = await db.transaction((tx) =>
      withDbExec(tx, () => archiveLocked(tx, connectionId, appId, snapshot)),
    );
    return { archived };
  } catch (error) {
    throw toArchiveError(error);
  }
}

/**
 * Soft-archives one personal credential profile for an exact app. A missing or
 * foreign row returns archived false; an already-disabled validated row returns
 * true. There is no delete, secret read, config rewrite, grant change, or readback.
 */
export function createPersonalWorkspaceCredentialArchiveService(options: {
  appId: string;
}) {
  const appId = readAppId(options);
  return Object.freeze({
    archive: (input: {
      connectionId: string;
    }): Promise<{ archived: boolean }> => archiveConnection(appId, input),
  });
}
