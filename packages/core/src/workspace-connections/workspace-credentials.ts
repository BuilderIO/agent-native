/** Native validated credentials for workspace-wide connections.
 * Server-only: callers must never expose create input or resolved values in
 * action history, logs or browser output. Project grants are not modeled here.
 */
import { createHash } from "node:crypto";

import { actionFailureEffect, isNoWriteError } from "../action.js";
import { getDbExec, withDbExec, type DbExec } from "../db/client.js";
import {
  ensureTable,
  readAppSecret,
  writeAppSecret,
} from "../secrets/storage.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import {
  getRequestContext,
  runWithRequestContext,
  type RequestContext,
} from "../server/request-context.js";
import {
  createWorkspaceCredentialProviderSnapshot,
  readPersonalCredentialDataArray,
  readPersonalCredentialDataRecord,
  type PersonalCredentialProviderDefinition,
} from "./personal-provider-definitions.js";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
  getWorkspaceConnectionGrant,
  listWorkspaceConnectionGrants,
  resolveWorkspaceConnectionForApp,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  type SerializedWorkspaceConnection,
  type SerializedWorkspaceConnectionGrant,
  type WorkspaceConnectionForApp,
} from "./store.js";
import { WORKSPACE_CREDENTIAL_MARKER } from "./workspace-credential-marker.js";

export { WORKSPACE_CREDENTIAL_MARKER } from "./workspace-credential-marker.js";
const PROFILE = "workspace-v1";
export type WorkspaceCredentialConfigValue = string | number | boolean;
export interface WorkspaceCredentialValidationInput {
  readonly provider: string;
  readonly config: Readonly<Record<string, WorkspaceCredentialConfigValue>>;
  readonly secretValues: ReadonlyArray<
    Readonly<{ key: string; secret: string }>
  >;
  readonly signal: AbortSignal;
}
export interface WorkspaceCredentialCreateInput {
  operationId: string;
  name?: string | undefined;
  config?: Record<string, WorkspaceCredentialConfigValue> | undefined;
  secretValues: ReadonlyArray<{ key: string; secret: string }>;
}
export interface WorkspaceCredentialServiceOptions {
  appId: string;
  provider: PersonalCredentialProviderDefinition;
  /** Mandatory bounded read-only provider check. Honor signal; no data writes.
   * Bounded authentication exchanges are permitted, without unsafe replay. */
  validateCredentials(input: WorkspaceCredentialValidationInput): Promise<void>;
  /** Trusted server limit, 1..30000 milliseconds. Defaults to 15000. */
  validationTimeoutMs?: number;
  /** Trusted server integration only. Runs inside native update publication,
   * before row locks and writes; throwing rolls back the whole update.
   * Never receives credentials or browser-provided callbacks. */
  beforeUpdateCommit?(input: {
    connectionId: string;
    transaction: DbExec;
  }): Promise<void>;
}
export class WorkspaceCredentialError extends Error {
  readonly code:
    | "invalid_input"
    | "forbidden"
    | "validation_failed"
    | "conflict"
    | "refused"
    | "storage_failed";
  constructor(code: WorkspaceCredentialError["code"]) {
    super("The workspace credential operation could not be completed.");
    this.name = "WorkspaceCredentialError";
    this.code = code;
  }
}
function fail(code: WorkspaceCredentialError["code"]): never {
  throw new WorkspaceCredentialError(code);
}
function record(
  value: unknown,
  keys?: readonly string[],
): Record<string, unknown> {
  try {
    return readPersonalCredentialDataRecord(
      value,
      keys ? new Set(keys) : undefined,
    );
  } catch {
    return fail("invalid_input");
  }
}
function array(value: unknown): unknown[] {
  try {
    return readPersonalCredentialDataArray(value);
  } catch {
    return fail("invalid_input");
  }
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail("invalid_input");
  return value.trim();
}
interface Actor {
  email: string;
  orgId: string;
  authUserId: string | undefined;
}
function actor(): Actor {
  const context = getRequestContext();
  if (
    !context ||
    typeof context.userEmail !== "string" ||
    !context.userEmail.trim() ||
    typeof context.orgId !== "string" ||
    !context.orgId.trim()
  )
    fail("forbidden");
  return {
    email: context.userEmail.trim().toLowerCase(),
    orgId: context.orgId.trim(),
    authUserId: context.authUserId,
  };
}
async function authorize(expected: Actor, manage: boolean): Promise<void> {
  const current = actor();
  if (
    current.email !== expected.email ||
    current.orgId !== expected.orgId ||
    current.authUserId !== expected.authUserId
  )
    fail("forbidden");
  let role: string | null;
  try {
    role = await readOrgMemberRole(current.orgId, current.email);
  } catch {
    return fail("forbidden");
  }
  if (role !== "owner" && role !== "admin" && (manage || role !== "member"))
    fail("forbidden");
  const after = actor();
  if (
    after.email !== expected.email ||
    after.orgId !== expected.orgId ||
    after.authUserId !== expected.authUserId
  )
    fail("forbidden");
}
function digest(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
function namespace(connection: {
  id: string;
  orgId: string | null;
  provider: string;
}): string {
  return `wconnv1:${digest([connection.orgId, connection.id, connection.provider])}`;
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
interface Prepared {
  actor: Actor;
  appId: string;
  id: string;
  provider: string;
  name: string;
  config: Record<string, WorkspaceCredentialConfigValue>;
  secrets: Array<{ key: string; secret: string }>;
}
function refs(p: Prepared) {
  return p.secrets.map(({ key }) => ({
    key,
    provider: p.provider,
    scope: "org" as const,
    ref: WORKSPACE_CREDENTIAL_MARKER,
  }));
}
function storedConfig(p: Prepared) {
  return {
    ...p.config,
    workspaceConnectionScope: "workspace",
    workspaceCredentialProfile: PROFILE,
  };
}
function profileMatches(
  c: SerializedWorkspaceConnection,
  g: SerializedWorkspaceConnectionGrant,
  appId: string,
  orgId: string,
  allowArchived = false,
): boolean {
  const cr = c.credentialRefs;
  return (
    c.orgId === orgId &&
    g.orgId === orgId &&
    (c.status === "connected" || (allowArchived && c.status === "disabled")) &&
    c.config.workspaceConnectionScope === "workspace" &&
    c.config.workspaceCredentialProfile === PROFILE &&
    c.allowedApps.length === 1 &&
    c.allowedApps[0] === appId &&
    c.allowedUsers.length === 0 &&
    (c.allowedUserGroups ?? []).length === 0 &&
    c.accountId === null &&
    c.accountLabel === null &&
    c.scopes.length === 0 &&
    g.scopes.length === 0 &&
    g.connectionId === c.id &&
    g.appId === appId &&
    g.provider === c.provider &&
    g.ownerEmail === c.ownerEmail &&
    g.grantedByEmail === c.ownerEmail &&
    same(c.config, g.config) &&
    same(cr, g.credentialRefs) &&
    cr.length > 0 &&
    new Set(cr.map((r) => r.key)).size === cr.length &&
    cr.every(
      (r) =>
        r.ref === WORKSPACE_CREDENTIAL_MARKER &&
        r.scope === "org" &&
        r.provider === c.provider &&
        typeof r.key === "string" &&
        r.key.trim() === r.key &&
        r.key.length > 0,
    )
  );
}
function credentialRevision(
  c: SerializedWorkspaceConnection,
  g: SerializedWorkspaceConnectionGrant,
): string {
  return digest([
    c.id,
    c.orgId,
    c.ownerEmail,
    c.provider,
    c.status,
    c.label,
    c.updatedAt,
    c.config,
    c.credentialRefs,
    c.allowedApps,
    c.allowedUsers,
    c.allowedUserGroups,
    g.id,
    g.appId,
    g.ownerEmail,
    g.grantedByEmail,
    g.updatedAt,
    g.config,
    g.credentialRefs,
  ]);
}
async function inspect(p: Prepared): Promise<"absent" | "match" | "conflict"> {
  const c = await getWorkspaceConnection(p.id),
    g = await getWorkspaceConnectionGrant(p.id, p.appId);
  if (!c && !g) return "absent";
  if (
    !c ||
    !g ||
    !profileMatches(c, g, p.appId, p.actor.orgId) ||
    c.ownerEmail !== p.actor.email ||
    c.provider !== p.provider ||
    c.label !== p.name ||
    !same(c.config, storedConfig(p)) ||
    !same(c.credentialRefs, refs(p))
  )
    return "conflict";
  for (const secret of p.secrets) {
    const saved = await readAppSecret({
      key: secret.key,
      scope: "org",
      scopeId: namespace(c),
    });
    if (!saved || saved.value !== secret.secret) return "conflict";
  }
  return "match";
}
function refusal(error: unknown): boolean {
  try {
    if (isNoWriteError(error) || actionFailureEffect(error) === "none")
      return true;
    if (error && typeof error === "object") {
      const e = error as { status?: unknown; statusCode?: unknown };
      return [e.status, e.statusCode].some(
        (s) =>
          typeof s === "number" && Number.isInteger(s) && s >= 400 && s < 500,
      );
    }
    return false;
  } catch {
    return true;
  }
}
export function createWorkspaceCredentialService(
  rawOptions: WorkspaceCredentialServiceOptions,
) {
  const options = record(rawOptions, [
    "appId",
    "provider",
    "validateCredentials",
    "validationTimeoutMs",
    "beforeUpdateCommit",
  ]);
  if (
    options.beforeUpdateCommit !== undefined &&
    typeof options.beforeUpdateCommit !== "function"
  )
    fail("invalid_input");
  const beforeUpdateCommit =
    options.beforeUpdateCommit as WorkspaceCredentialServiceOptions["beforeUpdateCommit"];
  const appId = text(options.appId);
  if (typeof options.validateCredentials !== "function") fail("invalid_input");
  const validate =
    options.validateCredentials as WorkspaceCredentialServiceOptions["validateCredentials"];
  let provider: PersonalCredentialProviderDefinition;
  try {
    const definition = createWorkspaceCredentialProviderSnapshot(
      options.provider,
    );
    if (definition.credentialKeys.length === 0) fail("invalid_input");
    provider = definition;
  } catch {
    return fail("invalid_input");
  }
  if (
    provider.configurationFields?.some(
      (f) => f.key === "workspaceCredentialProfile",
    )
  )
    fail("invalid_input");
  const timeoutMs = options.validationTimeoutMs ?? 15000;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    fail("invalid_input");
  const validationTimeoutMs: number = timeoutMs;
  function id(a: Actor, operationId: string) {
    return `wconn1:${digest([a.orgId, a.email, appId, operationId])}`;
  }
  function prepare(raw: unknown, a: Actor): Prepared {
    const input = record(raw, [
      "operationId",
      "name",
      "config",
      "secretValues",
    ]);
    const operationId = text(input.operationId);
    const suppliedConfig = record(input.config ?? {});
    const config: Prepared["config"] = {};
    const fields = provider.configurationFields ?? [];
    if (
      Object.keys(suppliedConfig).some(
        (key) => !fields.some((f) => f.key === key),
      )
    )
      fail("invalid_input");
    for (const field of fields) {
      const v = suppliedConfig[field.key] ?? field.defaultValue;
      if (v === undefined) {
        if (field.required) fail("invalid_input");
        continue;
      }
      if (typeof v === "string") config[field.key] = text(v);
      else if (
        typeof v === "boolean" ||
        (typeof v === "number" && Number.isFinite(v))
      )
        config[field.key] = v;
      else fail("invalid_input");
    }
    const seen = new Set<string>();
    const secrets = array(input.secretValues)
      .map((value) => {
        const secret = record(value, ["key", "secret"]),
          key = text(secret.key);
        const field = provider.credentialKeys.find((f) => f.key === key);
        if (
          !field ||
          seen.has(key) ||
          typeof secret.secret !== "string" ||
          !secret.secret.trim()
        )
          fail("invalid_input");
        seen.add(key);
        return {
          key,
          secret: field.preserveWhitespace
            ? secret.secret
            : secret.secret.trim(),
        };
      })
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (
      secrets.length === 0 ||
      provider.credentialKeys.some((f) => f.required && !seen.has(f.key))
    )
      fail("invalid_input");
    return {
      actor: a,
      appId,
      id: id(a, operationId),
      provider: provider.id,
      name: input.name === undefined ? provider.label : text(input.name),
      config,
      secrets,
    };
  }
  async function validatePrepared(p: Prepared): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const validation = Promise.resolve().then(() =>
        validate(
          Object.freeze({
            provider: p.provider,
            config: Object.freeze({ ...p.config }),
            secretValues: Object.freeze(
              p.secrets.map((s) => Object.freeze({ ...s })),
            ),
            signal: controller.signal,
          }),
        ),
      );
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new WorkspaceCredentialError("validation_failed"));
        }, validationTimeoutMs);
      });
      if ((await Promise.race([validation, deadline])) !== undefined)
        fail("validation_failed");
    } catch {
      return fail("validation_failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }
  async function archiveConnectionId(
    a: Actor,
    connectionId: string,
    requireOwner = true,
  ): Promise<{ archived: boolean }> {
    try {
      await ensureWorkspaceConnectionsTable();
      await authorize(a, true);
      const db = getDbExec();
      if (typeof db.transaction !== "function") fail("storage_failed");
      return await db.transaction(async (tx) =>
        withDbExec(tx, async () => {
          await tx.execute({
            sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
            args: [`workspace-credential:${connectionId}`],
          });
          await authorize(a, true);
          await tx.execute({
            sql: "SELECT id FROM public.workspace_connections WHERE id = ? AND org_id = ? FOR UPDATE",
            args: [connectionId, a.orgId],
          });
          const c = await getWorkspaceConnection(connectionId);
          const grants = await listWorkspaceConnectionGrants({
            connectionId,
          });
          await authorize(a, true);
          if (!c && grants.length === 0) return { archived: false };
          const g = grants.at(0);
          if (
            !c ||
            !g ||
            grants.length !== 1 ||
            (requireOwner && c.ownerEmail !== a.email) ||
            c.provider !== provider.id ||
            !profileMatches(c, g, appId, a.orgId, true)
          )
            fail("conflict");
          if (c.status !== "disabled") {
            const updated = await tx.execute({
              sql: "UPDATE public.workspace_connections SET status = 'disabled', updated_at = ? WHERE id = ? AND owner_email = ? AND org_id = ? AND status = 'connected'",
              args: [Date.now(), connectionId, c.ownerEmail, a.orgId],
            });
            if (updated.rowsAffected !== 1) fail("storage_failed");
          }
          await authorize(a, true);
          return { archived: true };
        }),
      );
    } catch (error) {
      if (error instanceof WorkspaceCredentialError) throw error;
      if (refusal(error)) return fail("refused");
      return fail("storage_failed");
    }
  }
  return Object.freeze({
    /** Soft-archive only a source created by this actor and operation. The
     * encrypted records and grants remain; disabled sources cannot resolve.
     * No reconciliation or retry is attempted after a transaction error.
     * Await creation settlement first: this does not cancel an unpublished
     * create or install a tombstone for an operation that has no source. */
    async archiveCreatedConnection(raw: {
      operationId: string;
    }): Promise<{ archived: boolean }> {
      const input = record(raw, ["operationId"]),
        a = actor();
      await authorize(a, true);
      const connectionId = id(a, text(input.operationId));
      return archiveConnectionId(a, connectionId);
    },
    /** Reopened row controls have a durable ID but no browser create journal.
     * The current manager, organization, app, native profile and grant checks in
     * the shared archive transaction remain mandatory. */
    async archiveConnection(raw: {
      connectionId: string;
    }): Promise<{ archived: boolean }> {
      const input = record(raw, ["connectionId"]),
        a = actor();
      await authorize(a, true);
      return archiveConnectionId(a, text(input.connectionId), false);
    },
    /** Full native edit, with an optimistic nonsecret revision. Provider
     * validation occurs before a transaction; publication rechecks the source,
     * grant, vault and current manager. Unknown acknowledgements are errors,
     * never an automatic retry or a new source. */
    async update(raw: {
      connectionId: string;
      revision: string;
      name?: string | undefined;
      config?: Record<string, WorkspaceCredentialConfigValue> | undefined;
      secretValues?: ReadonlyArray<{ key: string; secret: string }> | undefined;
    }): Promise<{ connectionId: string }> {
      const input = record(raw, [
          "connectionId",
          "revision",
          "name",
          "config",
          "secretValues",
        ]),
        a = actor();
      await authorize(a, true);
      const connectionId = text(input.connectionId),
        revision = text(input.revision);
      async function snapshot() {
        await authorize(a, true);
        const c = await getWorkspaceConnection(connectionId);
        const grants = await listWorkspaceConnectionGrants({ connectionId });
        const g = grants.at(0);
        await authorize(a, true);
        if (!c) fail("forbidden");
        if (
          !g ||
          grants.length !== 1 ||
          c.provider !== provider.id ||
          !profileMatches(c, g, appId, a.orgId)
        )
          fail("conflict");
        if (credentialRevision(c, g) !== revision) fail("conflict");
        const allowedConfig = new Set([
          "workspaceConnectionScope",
          "workspaceCredentialProfile",
          ...(provider.configurationFields ?? []).map((field) => field.key),
        ]);
        if (Object.keys(c.config).some((key) => !allowedConfig.has(key)))
          fail("conflict");
        const secrets: Prepared["secrets"] = [];
        for (const ref of c.credentialRefs) {
          if (!provider.credentialKeys.some((field) => field.key === ref.key))
            fail("conflict");
          // A new context object avoids request-memoized plaintext when a
          // different request rotated the vault during provider validation.
          const context = getRequestContext();
          if (!context) fail("forbidden");
          const saved = await runWithRequestContext({ ...context }, () =>
            readAppSecret({
              key: ref.key,
              scope: "org",
              scopeId: namespace(c),
            }),
          );
          if (!saved) fail("storage_failed");
          secrets.push({ key: ref.key, secret: saved.value });
        }
        await authorize(a, true);
        return { c, g, secrets };
      }
      try {
        const before = await snapshot();
        const values = new Map(
          before.secrets.map((secret) => [secret.key, secret.secret]),
        );
        const seen = new Set<string>();
        for (const rawSecret of array(input.secretValues ?? [])) {
          const secret = record(rawSecret, ["key", "secret"]),
            key = text(secret.key);
          if (
            seen.has(key) ||
            !provider.credentialKeys.some((field) => field.key === key) ||
            typeof secret.secret !== "string"
          )
            fail("invalid_input");
          seen.add(key);
          values.set(key, secret.secret);
        }
        const config = Object.fromEntries(
          (provider.configurationFields ?? [])
            .filter((field) => Object.hasOwn(before.c.config, field.key))
            .map((field) => [field.key, before.c.config[field.key]]),
        );
        const p = prepare(
          {
            operationId: "native-edit",
            name: input.name ?? before.c.label,
            config: { ...config, ...record(input.config ?? {}) },
            secretValues: [...values].map(([key, secret]) => ({ key, secret })),
          },
          a,
        );
        p.id = connectionId;
        await validatePrepared(p);
        await authorize(a, true);
        const db = getDbExec();
        if (typeof db.transaction !== "function") fail("storage_failed");
        await db.transaction(async (tx) =>
          withDbExec(tx, async () => {
            await tx.execute({
              sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
              args: [`workspace-credential:${connectionId}`],
            });
            await beforeUpdateCommit?.({
              connectionId,
              transaction: tx,
            });
            await tx.execute({
              sql: "SELECT id FROM public.workspace_connections WHERE id = ? AND org_id = ? FOR UPDATE",
              args: [connectionId, a.orgId],
            });
            await tx.execute({
              sql: "SELECT id FROM public.workspace_connection_grants WHERE connection_id = ? AND org_id = ? FOR UPDATE",
              args: [connectionId, a.orgId],
            });
            await tx.execute({
              sql: "SELECT id FROM app_secrets WHERE scope = 'org' AND scope_id = ? FOR UPDATE",
              args: [namespace(before.c)],
            });
            const current = await snapshot();
            if (!same(before.secrets, current.secrets)) fail("conflict");
            for (const secret of p.secrets)
              await writeAppSecret({
                key: secret.key,
                value: secret.secret,
                scope: "org",
                scopeId: namespace(current.c),
              });
            // Secret-only edits must invalidate the form revision even when
            // the system clock repeats or moves backwards.
            const now = Math.max(
                Date.now(),
                Date.parse(current.c.updatedAt) + 1,
                Date.parse(current.g.updatedAt) + 1,
              ),
              configJson = JSON.stringify(storedConfig(p)),
              refsJson = JSON.stringify(refs(p));
            const row = await tx.execute({
              sql: "UPDATE public.workspace_connections SET label = ?, config_json = ?, credential_refs_json = ?, updated_at = ? WHERE id = ? AND org_id = ? AND owner_email = ?",
              args: [
                p.name,
                configJson,
                refsJson,
                now,
                connectionId,
                a.orgId,
                current.c.ownerEmail,
              ],
            });
            const grant = await tx.execute({
              sql: "UPDATE public.workspace_connection_grants SET config_json = ?, credential_refs_json = ?, updated_at = ? WHERE id = ? AND org_id = ? AND owner_email = ?",
              args: [
                configJson,
                refsJson,
                now,
                current.g.id,
                a.orgId,
                current.g.ownerEmail,
              ],
            });
            if (row.rowsAffected !== 1 || grant.rowsAffected !== 1)
              fail("storage_failed");
            await authorize(a, true);
          }),
        );
        await authorize(a, true);
        return { connectionId };
      } catch (error) {
        if (error instanceof WorkspaceCredentialError) throw error;
        if (refusal(error)) return fail("refused");
        return fail("storage_failed");
      }
    },
    async findCreatedConnection(raw: {
      operationId: string;
    }): Promise<{ connectionId: string } | null> {
      const input = record(raw, ["operationId"]),
        a = actor();
      await authorize(a, true);
      const connectionId = id(a, text(input.operationId));
      try {
        const c = await getWorkspaceConnection(connectionId),
          g = await getWorkspaceConnectionGrant(connectionId, appId);
        await authorize(a, true);
        if (!c && !g) return null;
        if (
          !c ||
          !g ||
          c.ownerEmail !== a.email ||
          c.provider !== provider.id ||
          !profileMatches(c, g, appId, a.orgId, true)
        )
          fail("conflict");
        return c.status === "disabled" ? null : { connectionId };
      } catch (error) {
        if (error instanceof WorkspaceCredentialError) throw error;
        return fail("storage_failed");
      }
    },
    async create(
      raw: WorkspaceCredentialCreateInput,
    ): Promise<{ connectionId: string }> {
      const a = actor();
      await authorize(a, true);
      const p = prepare(raw, a);
      await validatePrepared(p);
      await authorize(a, true);
      try {
        await ensureWorkspaceConnectionsTable();
        await ensureTable();
      } catch {
        return fail("storage_failed");
      }
      await authorize(a, true);
      const db = getDbExec();
      if (typeof db.transaction !== "function") fail("storage_failed");
      try {
        await db.transaction(async (tx) =>
          withDbExec(tx, async () => {
            await tx.execute({
              sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
              args: [`workspace-credential:${p.id}`],
            });
            await authorize(a, true);
            const state = await inspect(p);
            if (state === "match") return;
            if (state === "conflict") fail("conflict");
            for (const secret of p.secrets)
              await writeAppSecret({
                key: secret.key,
                value: secret.secret,
                scope: "org",
                scopeId: namespace({
                  id: p.id,
                  orgId: a.orgId,
                  provider: p.provider,
                }),
              });
            await upsertWorkspaceConnection({
              id: p.id,
              provider: p.provider,
              label: p.name,
              status: "connected",
              accountId: null,
              accountLabel: null,
              scopes: [],
              config: storedConfig(p),
              allowedApps: [appId],
              allowedUsers: [],
              allowedUserGroups: [],
              credentialRefs: refs(p),
            });
            await upsertWorkspaceConnectionGrant({
              connectionId: p.id,
              appId,
              provider: p.provider,
              scopes: [],
              config: storedConfig(p),
              credentialRefs: refs(p),
            });
            await authorize(a, true);
          }),
        );
      } catch (error) {
        if (error instanceof WorkspaceCredentialError) throw error;
        if (refusal(error)) return fail("refused");
        await authorize(a, true);
        let state: Awaited<ReturnType<typeof inspect>>;
        try {
          state = await inspect(p);
        } catch {
          return fail("storage_failed");
        }
        await authorize(a, true);
        if (state === "conflict") fail("conflict");
        if (state !== "match") fail("storage_failed");
      }
      await authorize(a, true);
      return { connectionId: p.id };
    },
  });
}

export interface WorkspaceCredentialProfile {
  profile: "workspace-v1";
  active: boolean;
  revision: string;
  connection: WorkspaceConnectionForApp;
}

/** Nonsecret metadata only. A profile marker is a candidate, never authority:
 * current membership, exact app visibility and the complete source/grant
 * contract are rechecked without decrypting a credential. */
export async function readWorkspaceCredentialProfile(input: {
  appId: string;
  connectionId: string;
  provider: string;
  requestContext: RequestContext | undefined;
}): Promise<WorkspaceCredentialProfile | null> {
  if (!input.requestContext) fail("forbidden");
  return runWithRequestContext(input.requestContext, async () => {
    const a = actor(),
      appId = text(input.appId),
      connectionId = text(input.connectionId),
      provider = text(input.provider);
    async function snapshot() {
      await authorize(a, false);
      const resolved = await resolveWorkspaceConnectionForApp({
        appId,
        provider,
        connectionId,
        includeDisabled: true,
      });
      const c = resolved.connection;
      if (
        !resolved.available ||
        !c ||
        c.id !== connectionId ||
        c.provider !== provider ||
        c.orgId !== a.orgId
      )
        fail("forbidden");
      const g = await getWorkspaceConnectionGrant(connectionId, appId);
      const native =
        c.config.workspaceCredentialProfile !== undefined ||
        c.credentialRefs.some(
          (ref) => ref.ref === WORKSPACE_CREDENTIAL_MARKER,
        ) ||
        g?.config.workspaceCredentialProfile !== undefined ||
        g?.credentialRefs.some(
          (ref) => ref.ref === WORKSPACE_CREDENTIAL_MARKER,
        ) === true;
      if (native && (!g || !profileMatches(c, g, appId, a.orgId, true)))
        fail("forbidden");
      await authorize(a, false);
      return {
        c,
        native,
        revision: g ? credentialRevision(c, g) : null,
        pin: JSON.stringify([c, g]),
      };
    }
    try {
      const before = await snapshot(),
        after = await snapshot();
      if (before.pin !== after.pin) fail("forbidden");
      if (!before.native) return null;
      if (before.revision === null) fail("forbidden");
      return {
        profile: "workspace-v1",
        active: before.c.status === "connected",
        revision: before.revision,
        connection: before.c,
      };
    } catch (error) {
      if (error instanceof WorkspaceCredentialError) throw error;
      return fail("storage_failed");
    }
  });
}

/** Explicit exact-source reader; no default selection or legacy fallback. */
export async function readWorkspaceCredential(input: {
  appId: string;
  connectionId: string;
  provider: string;
  key: string;
  requestContext: RequestContext | undefined;
}): Promise<string> {
  if (!input.requestContext) fail("forbidden");
  return runWithRequestContext(input.requestContext, async () => {
    const a = actor(),
      appId = text(input.appId),
      connectionId = text(input.connectionId),
      provider = text(input.provider),
      key = text(input.key);
    async function snapshot() {
      await authorize(a, false);
      const resolved = await resolveWorkspaceConnectionForApp({
        appId,
        provider,
        connectionId,
        requireConnected: true,
      });
      const c = resolved.connection,
        g = await getWorkspaceConnectionGrant(connectionId, appId);
      if (
        !resolved.available ||
        !c ||
        !g ||
        c.id !== connectionId ||
        c.provider !== provider ||
        !profileMatches(c, g, appId, a.orgId) ||
        !c.credentialRefs.some((r) => r.key === key)
      )
        fail("forbidden");
      await authorize(a, false);
      return {
        c,
        g,
        pin: JSON.stringify([
          c.id,
          c.ownerEmail,
          c.orgId,
          c.provider,
          c.status,
          c.label,
          c.updatedAt,
          c.config,
          c.credentialRefs,
          c.allowedApps,
          c.allowedUsers,
          c.allowedUserGroups,
          g.id,
          g.updatedAt,
          g.config,
          g.credentialRefs,
        ]),
      };
    }
    try {
      const before = await snapshot();
      const value = await readAppSecret({
        key,
        scope: "org",
        scopeId: namespace(before.c),
      });
      const after = await snapshot();
      if (before.pin !== after.pin || !value?.value) fail("forbidden");
      return value.value;
    } catch (error) {
      if (error instanceof WorkspaceCredentialError) throw error;
      return fail("storage_failed");
    }
  });
}
